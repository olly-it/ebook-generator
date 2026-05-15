import cv2
import numpy as np


def _bbox_iou(a, b):
    ax, ay, aw, ah = cv2.boundingRect(a)
    bx, by, bw, bh = cv2.boundingRect(b)
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    if inter == 0:
        return 0.0
    return inter / (aw * ah + bw * bh - inter)


def _approx_quad(contour):
    """Try increasing epsilons until approxPolyDP yields a convex 4-gon."""
    peri = cv2.arcLength(contour, True)
    for eps in (0.01, 0.015, 0.02, 0.025, 0.03, 0.04):
        approx = cv2.approxPolyDP(contour, eps * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return approx
    return None


def _quads_from_mask(mask, min_area, max_pages):
    """Extract up to max_pages convex 4-gon contours from a binary mask."""
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    quads, raws = [], []
    for c in contours:
        if cv2.contourArea(c) < min_area:
            break
        approx = _approx_quad(c)
        if approx is None:
            continue
        if any(_bbox_iou(approx, p) > 0.3 for p in raws):
            continue
        quads.append(approx.reshape(4, 2).astype('float32'))
        raws.append(approx)
        if len(quads) >= max_pages:
            break
    return quads


def find_page_contours(image, max_pages=6):
    """
    Detect rectangular page regions. Returns list of (4,2) float32 arrays
    sorted in reading order (top→bottom, left→right).

    Strategy: try several thresholding approaches and merge the resulting
    quads. This handles both scans with dark borders around light pages
    (Otsu binary) and book covers (dark object on light background, Otsu
    inverted), plus the legacy Canny+adaptive path as a fallback.
    """
    h, w = image.shape[:2]
    # Require quads to cover >=10% of the image — filters out spurious quads
    # picked up on labels/stickers/inset boxes inside the page.
    min_area = w * h * 0.10

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, otsu_inv = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    adaptive = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                     cv2.THRESH_BINARY, 11, 2)
    edged = cv2.Canny(blurred, 30, 120)
    edged = cv2.dilate(edged, np.ones((3, 3), np.uint8), iterations=2)
    legacy = cv2.bitwise_or(cv2.bitwise_not(adaptive), edged)

    # Run all three strategies; merge quads, deduping by bbox IoU.
    merged, merged_bboxes = [], []
    for mask in (otsu, otsu_inv, legacy):
        for q in _quads_from_mask(mask, min_area, max_pages):
            qi = q.astype(np.int32)
            if any(_bbox_iou(qi, b) > 0.3 for b in merged_bboxes):
                continue
            merged.append(q)
            merged_bboxes.append(qi)

    # Prefer larger quads (more page-like) up to max_pages
    merged.sort(key=lambda q: cv2.contourArea(q.astype(np.int32)), reverse=True)
    merged = merged[:max_pages]
    merged.sort(key=lambda q: (q[:, 1].mean(), q[:, 0].mean()))
    return merged


# ---------------------------------------------------------------------------
# Orientation helpers
# ---------------------------------------------------------------------------

def count_horizontal_lines(image):
    """
    Count near-horizontal lines in the image — proxy for correctly-oriented text.
    Works on a small copy for speed.
    """
    h, w = image.shape[:2]
    scale = min(1.0, 600 / max(h, w))
    small = cv2.resize(image, (int(w * scale), int(h * scale)))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if len(small.shape) == 3 else small
    edges = cv2.Canny(gray, 40, 120)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=20,
                             minLineLength=int(30 * scale), maxLineGap=6)
    if lines is None:
        return 0
    count = 0
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if angle < 15 or angle > 165:
            count += 1
    return count


def auto_orient(image):
    """
    Detect and correct 90° / 270° rotation of a single page image.

    Strategy: test the original, CW, and CCW orientations; pick the one
    with the most near-horizontal lines (i.e. correctly-oriented text).
    Only rotates when there is a clear, unambiguous winner.

    Returns (corrected_image, degrees_rotated).
    """
    h, w = image.shape[:2]

    # Portrait or square — assume already correct
    if h >= w * 0.9:
        return image, 0

    cw  = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    ccw = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)

    s_orig = count_horizontal_lines(image)
    s_cw   = count_horizontal_lines(cw)
    s_ccw  = count_horizontal_lines(ccw)

    best_score = max(s_orig, s_cw, s_ccw)

    # Require: rotated version is strictly better AND both minimum signal and margin
    if s_cw == best_score and s_cw > s_orig * 1.25 and s_cw >= 6:
        return cw, 90
    if s_ccw == best_score and s_ccw > s_orig * 1.25 and s_ccw >= 6:
        return ccw, 270

    # No clear winner → keep original
    return image, 0


# ---------------------------------------------------------------------------
# Spread detection
# ---------------------------------------------------------------------------

def _has_book_spine(gray, w):
    """
    Return True if there is a single, narrow, continuous dark vertical stripe
    in the central band — characteristic of a book spine.

    Deliberately strict to avoid false positives from rotated text lines:
    - requires the dark region to be ONE contiguous band
    - that band must be narrower than 8% of the search strip
    - the band must be at least 20% darker than the strip average
    """
    cx_l, cx_r = int(w * 0.28), int(w * 0.72)
    strip = gray[:, cx_l:cx_r]
    col_means = strip.mean(axis=0)
    ksize = max(3, int(strip.shape[1] * 0.015))
    smoothed = np.convolve(col_means, np.ones(ksize) / ksize, mode='same')
    # Trim boundary artifacts introduced by zero-padding in convolve
    margin = ksize + 1
    smoothed = smoothed[margin:-margin]
    if len(smoothed) < 10:
        return False

    threshold = smoothed.mean() * 0.80   # must be ≥20% darker than average
    dark_mask = smoothed < threshold
    if not dark_mask.any():
        return False

    # Identify contiguous dark runs
    runs = []
    start = None
    for i, d in enumerate(dark_mask):
        if d and start is None:
            start = i
        elif not d and start is not None:
            runs.append(i - start)
            start = None
    if start is not None:
        runs.append(len(dark_mask) - start)

    strip_w = cx_r - cx_l
    # A real spine: at most 2 adjacent runs, each narrower than 8% of strip
    if not runs or len(runs) > 3:
        return False
    return max(runs) < strip_w * 0.08


def is_double_spread(image):
    """
    Decide whether the image is a double-page spread.

    Decision tree:
    1. Must be landscape (w > h * 1.15)
    2. If a narrow continuous dark stripe exists in the center → spread (open book)
    3. Otherwise compare horizontal-line counts for original vs 90°/270° rotations:
       - If original already has the most horizontal text → it's a real landscape spread
       - If a rotation gives more horizontal text → it's a rotated portrait page
    """
    h, w = image.shape[:2]
    if w <= h * 1.15:
        return False   # portrait or square → definitely a single page

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Strong signal: visible book spine
    if _has_book_spine(gray, w):
        return True

    # Weak signal: use text-line direction to break the tie
    s_h   = count_horizontal_lines(image)
    cw    = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    ccw   = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    s_cw  = count_horizontal_lines(cw)
    s_ccw = count_horizontal_lines(ccw)

    # Spread: original orientation already has the most horizontal lines
    # Rotated page: a rotation gives more horizontal lines
    if s_h >= max(s_cw, s_ccw) and s_h >= 5:
        return True

    return False


def _is_vertical_double(image):
    """
    Detect a portrait image that contains two pages scanned sideways (stacked top/bottom).

    Criteria:
    1. Portrait overall: h > w * 1.2
    2. Each half would be landscape when split: h/2 < w  (i.e. h < 2*w)
    3. Both halves benefit from a 90° rotation — the text lines in each half
       are rotated, confirming each half is a sideways-scanned book page.
    """
    h, w = image.shape[:2]

    if h <= w * 1.2:
        return False
    if h >= w * 2.0:
        return False

    mid = h // 2
    top_half = image[:mid, :]
    bot_half = image[mid:, :]

    def _wants_rotation(img):
        s_orig = count_horizontal_lines(img)
        cw  = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        ccw = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
        best = max(count_horizontal_lines(cw), count_horizontal_lines(ccw))
        return best > s_orig * 1.2 and best >= 4

    return _wants_rotation(top_half) and _wants_rotation(bot_half)


def find_gutter(image):
    """
    Find the x-coordinate of the book spine in a confirmed double-page spread.
    Falls back to visual center when no concentrated dark stripe is found.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    cx_l, cx_r = int(w * 0.25), int(w * 0.75)
    strip = gray[:, cx_l:cx_r]
    col_means = strip.mean(axis=0)
    ksize = max(5, int((cx_r - cx_l) * 0.02))
    smoothed = np.convolve(col_means, np.ones(ksize) / ksize, mode='same')

    min_val  = smoothed.min()
    mean_val = smoothed.mean()
    if min_val < mean_val * 0.90:
        return cx_l + int(np.argmin(smoothed))
    return w // 2
