#!/usr/bin/env python3
"""
process_image.py — perspective correction and page extraction for ebook-generator.

Auto-detects:
  • EXIF orientation (phone photos taken sideways are corrected automatically)
  • Single vs double-page spreads (automatically splits open-book spreads)
  • Page rotation (Hough-line analysis picks the orientation with most horizontal text)

Usage:
  python3 process_image.py --input <file> --outdir <dir> [--srcdir <dir>]
  python3 process_image.py --input <img> --outdir <dir> --corners "[[x,y],...]" [--rotate N]
  python3 process_image.py --inplace <img> --rotate N

Stdout: JSON { "pages": [...], "error": null }
"""

import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from detector import find_page_contours, is_double_spread, find_gutter, auto_orient, _is_vertical_double
from perspective import four_point_transform, order_points


# ---------------------------------------------------------------------------
# Image loading — respects EXIF orientation
# ---------------------------------------------------------------------------

def load_image(path):
    """Load image and apply EXIF orientation. Phone photos taken sideways are auto-corrected."""
    try:
        from PIL import Image, ImageOps
        pil = ImageOps.exif_transpose(Image.open(path))
        arr = np.array(pil.convert('RGB'))
        return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    except Exception:
        return cv2.imread(path)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ts():
    return f"{int(time.time() * 1000)}_{os.getpid()}"


def _save(image, directory, suffix=''):
    os.makedirs(directory, exist_ok=True)
    filename = f"page_{_ts()}{suffix}.jpg"
    cv2.imwrite(os.path.join(directory, filename), image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    h, w = image.shape[:2]
    return filename, w, h


def _rotate_cv(image, degrees):
    rot_map = {90: cv2.ROTATE_90_CLOCKWISE, -90: cv2.ROTATE_90_COUNTERCLOCKWISE,
               270: cv2.ROTATE_90_COUNTERCLOCKWISE, 180: cv2.ROTATE_180}
    if degrees in rot_map:
        return cv2.rotate(image, rot_map[degrees])
    return image


# ---------------------------------------------------------------------------
# PDF rendering (PyMuPDF)
# ---------------------------------------------------------------------------

def render_pdf(pdf_path, srcdir):
    """Render each PDF page to a JPEG in srcdir. Returns [(array, filepath), ...]."""
    import fitz
    os.makedirs(srcdir, exist_ok=True)
    doc = fitz.open(pdf_path)
    results = []
    for idx, page in enumerate(doc):
        mat = fitz.Matrix(200 / 72, 200 / 72)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        fn = f"src_pdf_p{idx}_{_ts()}.jpg"
        fp = os.path.join(srcdir, fn)
        cv2.imwrite(fp, bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
        results.append((bgr, fp))
    doc.close()
    return results


# ---------------------------------------------------------------------------
# Core processing of a single image array
# ---------------------------------------------------------------------------

def process_image_array(image, source_path, outdir, extra_rotation=0):
    """
    Detect pages in *image*, correct perspective, auto-orient each page.
    Returns list of page dicts.
    """
    h, w = image.shape[:2]

    # Downscale for detection only (keeps it fast on high-res images)
    scale = 1.0
    if max(h, w) > 2000:
        scale = 2000 / max(h, w)
        detect_img = cv2.resize(image, (int(w * scale), int(h * scale)))
    else:
        detect_img = image

    quads = find_page_contours(detect_img)
    pages = []

    def make_page(img, meta, suffix=''):
        """Apply optional extra rotation, save, return page dict."""
        if extra_rotation:
            img = _rotate_cv(img, extra_rotation)
        fn, pw, ph = _save(img, outdir, suffix)
        return {'filename': fn, 'source_image': source_path,
                'width': pw, 'height': ph, 'processing_meta': meta}

    def warp_and_orient(pts, meta_base, suffix=''):
        """Perspective-correct, then auto-orient to portrait."""
        warped = four_point_transform(image, pts)
        if warped is None:
            return None
        oriented, auto_rot = auto_orient(warped)
        meta = {**meta_base}
        if auto_rot:
            meta['auto_rotation_deg'] = auto_rot
        return make_page(oriented, meta, suffix)

    # ── 2+ separate quads detected ────────────────────────────────────────
    if len(quads) >= 2:
        for i, quad in enumerate(quads):
            pts = quad / scale
            p = warp_and_orient(pts,
                {'contour_pts': order_points(pts).tolist(), 'method': 'multi_quad', 'quad_index': i},
                suffix=f'_{i}')
            if p:
                pages.append(p)
        return pages

    # ── Exactly 1 quad detected ───────────────────────────────────────────
    if len(quads) == 1:
        pts = quads[0] / scale
        warped = four_point_transform(image, pts)
        if warped is None:
            warped = image  # fallback to full image

        if is_double_spread(warped):
            pages.extend(_split_spread(warped, source_path, outdir, extra_rotation,
                                       source_pts=pts, source_shape=image.shape[:2]))
        elif _is_vertical_double(warped):
            pages.extend(_split_vertical_double(warped, source_path, outdir, extra_rotation,
                                                source_pts=pts, source_shape=image.shape[:2]))
        else:
            oriented, auto_rot = auto_orient(warped)
            meta = {'contour_pts': order_points(pts).tolist(), 'method': 'single_quad'}
            if auto_rot:
                meta['auto_rotation_deg'] = auto_rot
            if extra_rotation:
                oriented = _rotate_cv(oriented, extra_rotation)
            fn, pw, ph = _save(oriented, outdir)
            pages.append({'filename': fn, 'source_image': source_path,
                          'width': pw, 'height': ph, 'processing_meta': meta})
        return pages

    # ── No quad found ─────────────────────────────────────────────────────
    # Use the full image: landscape spread → split left/right;
    # portrait with two sideways pages stacked → split top/bottom;
    # otherwise treat as single page.
    if is_double_spread(image):
        pages.extend(_split_spread(image, source_path, outdir, extra_rotation,
                                   method='no_contour_spread'))
    elif _is_vertical_double(image):
        pages.extend(_split_vertical_double(image, source_path, outdir, extra_rotation))
    else:
        oriented, auto_rot = auto_orient(image)
        fh, fw = image.shape[:2]
        meta = {'method': 'no_contour_fallback',
                'contour_pts': [[0, 0], [fw, 0], [fw, fh], [0, fh]]}
        if auto_rot:
            meta['auto_rotation_deg'] = auto_rot
        if extra_rotation:
            oriented = _rotate_cv(oriented, extra_rotation)
        fn, pw, ph = _save(oriented, outdir)
        pages.append({'filename': fn, 'source_image': source_path,
                      'width': pw, 'height': ph, 'processing_meta': meta})

    return pages


def _split_vertical_double(image, source_path, outdir, extra_rotation, method='vertical_split', source_pts=None, source_shape=None):
    """Split a portrait image of two pages scanned sideways (stacked top/bottom).

    source_pts: optional (4,2) array of the detected quad in SOURCE image coordinates.
    When given, the per-half contour_pts are projected from that quad so they survive
    back to source image space even if `image` is perspective-corrected.
    source_shape: (h, w) of the source image; required when source_pts is given so
    `split_at` can be expressed as a fraction of source-image height (the editor UI
    overlays the split line on the source image, not on the warped one).
    """
    h, w = image.shape[:2]
    mid = h // 2

    # Compute per-half contour_pts in source image coordinates
    if source_pts is not None:
        tl, tr, br, bl = order_points(source_pts)
        t = 0.5  # split at midpoint of the warped quad height
        mid_r = tr + (br - tr) * t
        mid_l = tl + (bl - tl) * t
        # Explicitly TL/TR/BR/BL — do NOT apply order_points to sub-quads.
        # order_points uses sum/diff heuristics that work for rectangles but swap
        # TR and BL on the trapezoidal sub-quads produced by a mid-edge split.
        half_pts = [
            [tl.tolist(), tr.tolist(), mid_r.tolist(), mid_l.tolist()],
            [mid_l.tolist(), mid_r.tolist(), br.tolist(), bl.tolist()],
        ]
        sh, sw = source_shape if source_shape is not None else (h, w)
        split_at = float((mid_l[1] + mid_r[1]) / 2.0 / sh)
    else:
        half_pts = [
            [[0, 0], [w, 0], [w, mid], [0, mid]],
            [[0, mid], [w, mid], [w, h], [0, h]],
        ]
        split_at = 0.5

    pages = []
    for i, (side, half) in enumerate([('top', image[:mid, :]), ('bottom', image[mid:, :])]):
        oriented, auto_rot = auto_orient(half)
        meta = {
            'method': method, 'split_from': side,
            'split_at': split_at, 'split_direction': 'horizontal',
            'contour_pts': half_pts[i],
        }
        if auto_rot:
            meta['auto_rotation_deg'] = auto_rot
        if extra_rotation:
            oriented = _rotate_cv(oriented, extra_rotation)
        fn, pw, ph = _save(oriented, outdir, f'_{side}')
        pages.append({'filename': fn, 'source_image': source_path,
                      'width': pw, 'height': ph, 'processing_meta': meta})
    return pages


def _split_spread(image, source_path, outdir, extra_rotation, method='spread_split', source_pts=None, source_shape=None):
    """Split a double-page spread at the detected gutter.

    source_pts: optional (4,2) array of the detected quad in SOURCE image coordinates.
    When given, the per-half contour_pts are projected from that quad.
    source_shape: (h, w) of the source image; required when source_pts is given so
    `split_at` can be expressed as a fraction of source-image width (the editor UI
    overlays the split line on the source image, not on the warped one).
    """
    h, w = image.shape[:2]
    gutter_x = find_gutter(image)
    t = gutter_x / w  # fraction of split along the warped quad's width

    # Compute per-half contour_pts in source image coordinates
    if source_pts is not None:
        tl, tr, br, bl = order_points(source_pts)
        top_mid = tl + (tr - tl) * t
        bot_mid = bl + (br - bl) * t
        # Explicitly TL/TR/BR/BL — same reasoning as _split_vertical_double.
        half_pts = [
            [tl.tolist(), top_mid.tolist(), bot_mid.tolist(), bl.tolist()],
            [top_mid.tolist(), tr.tolist(), br.tolist(), bot_mid.tolist()],
        ]
        sh, sw = source_shape if source_shape is not None else (h, w)
        split_at = float((top_mid[0] + bot_mid[0]) / 2.0 / sw)
    else:
        half_pts = [
            [[0, 0], [gutter_x, 0], [gutter_x, h], [0, h]],
            [[gutter_x, 0], [w, 0], [w, h], [gutter_x, h]],
        ]
        split_at = t

    pages = []
    for i, (side, crop) in enumerate([('left', image[:, :gutter_x]), ('right', image[:, gutter_x:])]):
        if crop.shape[1] < 50:
            continue
        meta = {
            'method': method, 'split_from': side,
            'split_at': split_at, 'split_direction': 'vertical',
            'contour_pts': half_pts[i],
        }
        if extra_rotation:
            crop = _rotate_cv(crop, extra_rotation)
        fn, pw, ph = _save(crop, outdir, f'_{side}')
        pages.append({'filename': fn, 'source_image': source_path,
                      'width': pw, 'height': ph, 'processing_meta': meta})
    return pages


# ---------------------------------------------------------------------------
# Manual corners mode
# ---------------------------------------------------------------------------

def process_with_corners(image, source_path, corners, rotation, outdir):
    pts = np.array(corners, dtype='float32')
    warped = four_point_transform(image, pts)
    if warped is None:
        warped = image
    if rotation:
        warped = _rotate_cv(warped, rotation)
    fn, pw, ph = _save(warped, outdir)
    meta = {'contour_pts': pts.tolist(), 'method': 'manual', 'rotation': rotation}
    return {'filename': fn, 'source_image': source_path,
            'width': pw, 'height': ph, 'processing_meta': meta}


# ---------------------------------------------------------------------------
# Rotate-in-place mode
# ---------------------------------------------------------------------------

def rotate_inplace(path, degrees):
    image = cv2.imread(path)
    if image is None:
        return f'Cannot read {path}', None
    rotated = _rotate_cv(image, degrees)
    cv2.imwrite(path, rotated, [cv2.IMWRITE_JPEG_QUALITY, 92])
    h, w = rotated.shape[:2]
    return None, {'inplace': True, 'width': w, 'height': h}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _split_manual(image, source_path, direction, split_at, rotate_a, rotate_b, outdir):
    """Cut image at split_at (0–1 ratio), apply per-part rotations, return page list."""
    h, w = image.shape[:2]
    if direction == 'horizontal':
        px = max(1, int(h * split_at))
        parts = [('top', image[:px, :]), ('bottom', image[px:, :])]
    else:
        px = max(1, int(w * split_at))
        parts = [('left', image[:, :px]), ('right', image[:, px:])]

    pages = []
    for (label, part), rot in zip(parts, [rotate_a, rotate_b]):
        if part.shape[0] < 10 or part.shape[1] < 10:
            continue
        if rot:
            part = _rotate_cv(part, rot)
        fn, pw, ph = _save(part, outdir, f'_{label}')
        meta = {
            'method': 'manual_split',
            'split_from': label,
            'split_at': split_at,
            'split_direction': direction,
            'rotation': rot,
        }
        pages.append({'filename': fn, 'source_image': source_path,
                      'width': pw, 'height': ph, 'processing_meta': meta})
    return pages


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input')
    parser.add_argument('--outdir')
    parser.add_argument('--srcdir')
    parser.add_argument('--corners')
    parser.add_argument('--rotate', type=int, default=0)
    parser.add_argument('--inplace')
    parser.add_argument('--split', choices=['horizontal', 'vertical'])
    parser.add_argument('--split-at', type=float, default=0.5)
    parser.add_argument('--rotate-a', type=int, default=0)
    parser.add_argument('--rotate-b', type=int, default=0)
    parser.add_argument('--detect-corners', action='store_true')
    parser.add_argument('--region')   # JSON "[x, y, w, h]" in source image coords
    args = parser.parse_args()

    try:
        # ── Rotate-in-place ───────────────────────────────────────────────
        if args.inplace:
            err, result = rotate_inplace(args.inplace, args.rotate)
            if err:
                print(json.dumps({'pages': [], 'error': err})); sys.exit(1)
            print(json.dumps({'pages': [result], 'error': None}))
            return

        # ── Detect corners mode ───────────────────────────────────────────
        if args.detect_corners:
            if not args.input:
                print(json.dumps({'corners': None, 'error': '--input required'})); sys.exit(1)
            image = load_image(args.input)
            if image is None:
                print(json.dumps({'corners': None, 'error': f'Cannot read {args.input}'})); sys.exit(1)
            offset_x, offset_y = 0, 0
            detect_img = image
            if args.region:
                rx, ry, rw, rh = [int(v) for v in json.loads(args.region)]
                detect_img = image[ry:ry + rh, rx:rx + rw]
                offset_x, offset_y = rx, ry
            h, w = detect_img.shape[:2]
            scale = min(1.0, 2000 / max(h, w)) if max(h, w) > 2000 else 1.0
            small = cv2.resize(detect_img, (int(w * scale), int(h * scale))) if scale < 1 else detect_img
            quads = find_page_contours(small)
            if quads:
                # order_points → TL, TR, BR, BL so the editor's edge handles
                # map correctly to top/right/bottom/left.
                pts = order_points(quads[0] / scale).tolist()
                pts = [[x + offset_x, y + offset_y] for x, y in pts]
                print(json.dumps({'corners': pts, 'error': None}))
            else:
                print(json.dumps({'corners': None, 'error': None}))
            return

        # ── Manual split mode ─────────────────────────────────────────────
        if args.split:
            if not args.input or not args.outdir:
                print(json.dumps({'pages': [], 'error': '--input and --outdir required'}))
                sys.exit(1)
            image = load_image(args.input)
            if image is None:
                print(json.dumps({'pages': [], 'error': f'Cannot read {args.input}'}))
                sys.exit(1)
            os.makedirs(args.outdir, exist_ok=True)
            pages = _split_manual(image, args.input, args.split,
                                  args.split_at, args.rotate_a, args.rotate_b, args.outdir)
            print(json.dumps({'pages': pages, 'error': None}))
            return

        if not args.input or not args.outdir:
            print(json.dumps({'pages': [], 'error': '--input and --outdir required'}))
            sys.exit(1)

        ext = os.path.splitext(args.input)[1].lower()

        # ── Manual corners ────────────────────────────────────────────────
        if args.corners:
            corners = json.loads(args.corners)
            image = load_image(args.input)
            if image is None:
                print(json.dumps({'pages': [], 'error': f'Cannot read {args.input}'}))
                sys.exit(1)
            page = process_with_corners(image, args.input, corners, args.rotate, args.outdir)
            print(json.dumps({'pages': [page], 'error': None}))
            return

        # ── Auto mode ─────────────────────────────────────────────────────
        all_pages = []
        if ext == '.pdf':
            srcdir = args.srcdir or args.outdir
            for img_arr, src_path in render_pdf(args.input, srcdir):
                all_pages.extend(process_image_array(img_arr, src_path, args.outdir, args.rotate))
        else:
            image = load_image(args.input)
            if image is None:
                print(json.dumps({'pages': [], 'error': f'Cannot read {args.input}'}))
                sys.exit(1)
            all_pages = process_image_array(image, args.input, args.outdir, args.rotate)

        print(json.dumps({'pages': all_pages, 'error': None}))

    except Exception as e:
        import traceback
        print(json.dumps({'pages': [], 'error': str(e), 'trace': traceback.format_exc()}))
        sys.exit(1)


if __name__ == '__main__':
    main()
