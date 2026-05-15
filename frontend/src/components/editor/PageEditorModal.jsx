import { useState, useEffect, useRef, useMemo } from 'react';
import CropCanvas from '../review/CropCanvas';
import SplitCanvas from './SplitCanvas';
import { detectCorners } from '../../api/client';

const SPLIT_METHODS = new Set(['vertical_split', 'spread_split', 'no_contour_spread', 'manual_split']);

function provenanceLabel(page) {
  const meta = page.processing_meta || {};
  let name = meta.original_filename || null;
  let pageIdx = meta.original_page_index;
  if (pageIdx == null && page.source_image) {
    const m = /\/src_pdf_p(\d+)_/.exec(page.source_image);
    if (m) pageIdx = parseInt(m[1], 10);
  }
  if (!name && pageIdx == null) return null;
  if (name && pageIdx != null) return `${name} · p. ${pageIdx + 1}`;
  if (pageIdx != null) return `p. ${pageIdx + 1}`;
  return name;
}

function inferDirection(meta) {
  if (!meta) return 'horizontal';
  if (meta.split_direction) return meta.split_direction;
  if (meta.method === 'spread_split' || meta.method === 'no_contour_spread') return 'vertical';
  return 'horizontal';
}

// Reconstruct the full source quad [TL, TR, BR, BL] from two split halves'
// contour_pts. Python emits these as (see _split_spread / _split_vertical_double):
//   horizontal split: A = [tl, tr, mid_r, mid_l], B = [mid_l, mid_r, br, bl]
//   vertical   split: A = [tl, top_mid, bot_mid, bl], B = [top_mid, tr, br, bot_mid]
// Returns null when either half lacks a 4-point contour.
function reconstructOriginalQuad(aCorners, bCorners, direction) {
  if (!aCorners || !bCorners || aCorners.length !== 4 || bCorners.length !== 4) return null;
  if (direction === 'horizontal') {
    return [aCorners[0], aCorners[1], bCorners[2], bCorners[3]];
  }
  return [aCorners[0], bCorners[1], bCorners[2], aCorners[3]];
}

// Project a quad [TL, TR, BR, BL] onto a half at split ratio t for a given
// direction. Returns the half's [TL, TR, BR, BL] in source coordinates.
function projectHalf(quad, direction, t, half) {
  const [tl, tr, br, bl] = quad;
  const lerp = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  if (direction === 'horizontal') {
    const midL = lerp(tl, bl, t);
    const midR = lerp(tr, br, t);
    return half === 0 ? [tl, tr, midR, midL] : [midL, midR, br, bl];
  }
  const topMid = lerp(tl, tr, t);
  const botMid = lerp(bl, br, t);
  return half === 0 ? [tl, topMid, botMid, bl] : [topMid, tr, br, botMid];
}

// Restore previous state from page meta + siblings
function initFromMeta(page, siblings) {
  const meta = page.processing_meta || {};
  const isSplit = SPLIT_METHODS.has(meta.method);

  if (isSplit) {
    const aSib = siblings.find(s => {
      const m = s.processing_meta || {}; return m.split_from === 'top' || m.split_from === 'left';
    });
    const bSib = siblings.find(s => {
      const m = s.processing_meta || {}; return m.split_from === 'bottom' || m.split_from === 'right';
    });
    const aMeta = aSib?.processing_meta || {};
    const bMeta = bSib?.processing_meta || {};
    const direction = inferDirection(meta);
    const originalQuad = reconstructOriginalQuad(
      aMeta.contour_pts ?? null,
      bMeta.contour_pts ?? null,
      direction,
    );
    return {
      doSplit: true,
      direction,
      splitAt: meta.split_at ?? 0.5,
      originalQuad,
      parts: [
        { rotation: aMeta.rotation ?? aMeta.auto_rotation_deg ?? 0, corners: aMeta.contour_pts ?? null, processedFile: aSib?.processed_file ?? null },
        { rotation: bMeta.rotation ?? bMeta.auto_rotation_deg ?? 0, corners: bMeta.contour_pts ?? null, processedFile: bSib?.processed_file ?? null },
      ],
    };
  }

  return {
    doSplit: false,
    direction: 'horizontal',
    splitAt: 0.5,
    originalQuad: null,
    parts: [
      { rotation: meta.rotation ?? meta.auto_rotation_deg ?? 0, corners: meta.contour_pts ?? null, processedFile: page.processed_file ?? null },
      { rotation: 0, corners: null, processedFile: null },
    ],
  };
}

// Pixel-tolerant deep comparison for corner arrays
function cornersEqual(a, b, eps = 0.5) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > eps || Math.abs(a[i][1] - b[i][1]) > eps) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// OutputPreview — when corners are unchanged from the saved state, show the
// existing processed thumbnail (pixel-identical to the gallery). When the user
// drags a corner, fall back to a live canvas approximating the new crop.
// ---------------------------------------------------------------------------
function OutputPreview({ img, region, rotation, label, accent, staticUrl }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (staticUrl) return;
    const canvas = canvasRef.current;
    if (!canvas || !img || !region || region.w <= 0 || region.h <= 0) return;
    const { x, y, w, h } = region;
    const swapped = rotation === 90 || rotation === 270;
    const outW = swapped ? h : w;
    const outH = swapped ? w : h;
    const scale = Math.min(1, 190 / Math.max(outW, outH));
    canvas.width = Math.round(outW * scale);
    canvas.height = Math.round(outH * scale);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, x, y, w, h, -(w * scale) / 2, -(h * scale) / 2, w * scale, h * scale);
    ctx.restore();
  }, [img, region, rotation, staticUrl]);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[11px] font-semibold ${accent}`}>{label}</span>
      {staticUrl ? (
        <img
          src={staticUrl}
          alt={label}
          style={{ maxWidth: '100%', maxHeight: 190, border: '1px solid #e5e7eb', borderRadius: 4, display: 'block' }}
        />
      ) : (
        <canvas ref={canvasRef} style={{ maxWidth: '100%', border: '1px solid #e5e7eb', borderRadius: 4, display: 'block' }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------
export default function PageEditorModal({ page, siblings = [], bookId, saving, onSave, onClose }) {
  const init = useMemo(() => initFromMeta(page, siblings), []);

  const [doSplit, setDoSplit] = useState(init.doSplit);
  const [direction, setDirection] = useState(init.direction);
  const [splitAt, setSplitAt] = useState(init.splitAt);
  const [parts, setParts] = useState(init.parts); // [{rotation, corners}, ...]
  // Non-split pages open directly on the crop step; split pages start at the source step.
  const [step, setStep] = useState(init.doSplit ? 0 : 1);
  const [zoom, setZoom] = useState(1);
  const [previewImg, setPreviewImg] = useState(null);
  const [cropKeys, setCropKeys] = useState([0, 0]);
  const [autoDetecting, setAutoDetecting] = useState(false);
  // Per-half cropped image data URLs + bbox (source coords) used to translate
  // corners between CropCanvas space and source-image space.
  const [partImages, setPartImages] = useState([null, null]);

  // Track the split params that were in effect when corners were last initialised,
  // so we only reset corners when the user actually changes the split (not on mount).
  const prevSplitRef = useRef({ splitAt: init.splitAt, direction: init.direction });
  // Once the user manually drags a corner, stop reprojecting that part on split changes.
  const manualCornersRef = useRef([false, false]);
  // The detected source quad (full page, in source image coords) — if available,
  // we use it to reproject per-half corners as the split moves, preserving
  // perspective correction across split adjustments.
  const originalQuadRef = useRef(init.originalQuad);

  const sourceImage = page.source_image || page.source_file;
  const sourceUrl = sourceImage ? `/${sourceImage}` : `/${page.processed_file}`;

  // Load image for preview rendering
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setPreviewImg(img);
    img.src = sourceUrl;
  }, [sourceUrl]);

  // When the split line moves, reproject each part's corners along the original
  // detected quad so perspective correction is preserved. If no quad was detected
  // (or the user has manually edited a part's corners), leave that part alone —
  // initCornersFor will fall back to a plain rectangular split region.
  useEffect(() => {
    const prev = prevSplitRef.current;
    if (prev.splitAt === splitAt && prev.direction === direction) return;
    const directionChanged = prev.direction !== direction;
    prevSplitRef.current = { splitAt, direction };
    const quad = originalQuadRef.current;
    setParts(prevParts => prevParts.map((p, i) => {
      if (manualCornersRef.current[i]) return p;
      // Direction change invalidates the quad mapping; fall back to rect regions.
      if (!quad || directionChanged) return { ...p, corners: null };
      return { ...p, corners: projectHalf(quad, direction, splitAt, i) };
    }));
    if (directionChanged) originalQuadRef.current = null;
    setCropKeys(ks => ks.map(k => k + 1));
  }, [splitAt, direction]);

  // Bounding box (in source image coords) used as the visible image for the
  // CropCanvas of a given split part. Includes any existing corners so manually
  // dragged points outside the rectangular split region remain reachable.
  function partBBox(idx) {
    const r = splitRegion(idx);
    if (!r) return null;
    let { x, y, w, h } = r;
    const corners = parts[idx]?.corners;
    if (corners && corners.length === 4) {
      const xs = corners.map(c => c[0]);
      const ys = corners.map(c => c[1]);
      const minX = Math.min(x, ...xs);
      const minY = Math.min(y, ...ys);
      const maxX = Math.max(x + w, ...xs);
      const maxY = Math.max(y + h, ...ys);
      x = minX; y = minY; w = maxX - minX; h = maxY - minY;
    }
    if (previewImg) {
      const iw = previewImg.naturalWidth;
      const ih = previewImg.naturalHeight;
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(iw - x, w); h = Math.min(ih - y, h);
    }
    return { x, y, w, h };
  }

  // Render the cropped image for each split part to a data URL whenever the
  // split parameters change. Non-split pages use the full source image.
  useEffect(() => {
    if (!previewImg) { setPartImages([null, null]); return; }
    if (!doSplit) { setPartImages([null, null]); return; }
    const next = [0, 1].map(i => {
      const bbox = partBBox(i);
      if (!bbox || bbox.w <= 0 || bbox.h <= 0) return null;
      const c = document.createElement('canvas');
      c.width = bbox.w;
      c.height = bbox.h;
      const ctx = c.getContext('2d');
      ctx.drawImage(previewImg, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
      return { url: c.toDataURL('image/png'), bbox };
    });
    setPartImages(next);
    // Intentionally not depending on `parts` here — bbox recomputation is
    // tied to split changes, not to live corner edits.
  }, [previewImg, doSplit, direction, splitAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute the 4-corner rectangle for a split part (in source image coordinates)
  function splitRegion(idx) {
    if (!previewImg) return null;
    const iw = previewImg.naturalWidth;
    const ih = previewImg.naturalHeight;
    if (direction === 'horizontal') {
      const py = Math.round(ih * splitAt);
      return idx === 0
        ? { x: 0, y: 0, w: iw, h: py }
        : { x: 0, y: py, w: iw, h: ih - py };
    } else {
      const px = Math.round(iw * splitAt);
      return idx === 0
        ? { x: 0, y: 0, w: px, h: ih }
        : { x: px, y: 0, w: iw - px, h: ih };
    }
  }

  function regionToCorners(r) {
    if (!r) return null;
    return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  }

  function fullImageCorners() {
    if (!previewImg) return null;
    const { naturalWidth: w, naturalHeight: h } = previewImg;
    return [[0, 0], [w, 0], [w, h], [0, h]];
  }

  // Corners to show in CropCanvas for a given part. When the part is rendered
  // against a cropped source image (split mode), corners are translated into
  // the cropped image's coordinate frame so CropCanvas can position handles
  // directly.
  function initCornersFor(idx) {
    const sourceCorners = parts[idx].corners || (doSplit ? regionToCorners(splitRegion(idx)) : null);
    if (!sourceCorners) return null;
    if (!doSplit) return sourceCorners;
    const bbox = partImages[idx]?.bbox;
    if (!bbox) return sourceCorners;
    return sourceCorners.map(([x, y]) => [x - bbox.x, y - bbox.y]);
  }

  // Show the saved gallery thumbnail when corners + rotation + split match the
  // saved state — gives a pixel-perfect preview that matches what the user sees
  // in the gallery. Once anything changes, fall back to the dynamic canvas.
  function staticPreviewUrl(idx) {
    const orig = init.parts[idx];
    if (!orig?.processedFile) return null;
    if (parts[idx].rotation !== orig.rotation) return null;
    if (!cornersEqual(parts[idx].corners, orig.corners)) return null;
    if (doSplit !== init.doSplit) return null;
    if (init.doSplit && (direction !== init.direction || splitAt !== init.splitAt)) return null;
    return `/${orig.processedFile}`;
  }

  // Region for OutputPreview: bounding box of corners or split region
  function previewRegion(idx) {
    const corners = parts[idx].corners;
    if (corners) {
      const xs = corners.map(c => c[0]);
      const ys = corners.map(c => c[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    if (doSplit) return splitRegion(idx);
    if (previewImg) return { x: 0, y: 0, w: previewImg.naturalWidth, h: previewImg.naturalHeight };
    return null;
  }

  function updatePart(idx, field, value) {
    setParts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  // Called when CropCanvas reports new corners. CropCanvas emits on every redraw
  // (including the initial mount), so to detect a real user drag we compare
  // against the corners we last fed in. Once we see a meaningful change, we
  // mark the part as "manually edited" so the split-line useEffect stops
  // reprojecting its corners from the original detected quad.
  function handleUserCornersChange(idx, corners) {
    // CropCanvas reports corners in the canvas image's coord space. For split
    // parts the canvas image is a cropped bbox, so translate back to source
    // coordinates before storing.
    let sourceCorners = corners;
    if (doSplit && partImages[idx]?.bbox) {
      const { x: ox, y: oy } = partImages[idx].bbox;
      sourceCorners = corners.map(([x, y]) => [x + ox, y + oy]);
    }
    setParts(prev => {
      const cur = prev[idx];
      if (!cornersEqual(cur.corners, sourceCorners)) {
        manualCornersRef.current[idx] = true;
      }
      return prev.map((p, i) => i === idx ? { ...p, corners: sourceCorners } : p);
    });
  }

  async function handleAutoDetect(partIdx) {
    if (!previewImg || !sourceImage) return;
    setAutoDetecting(true);
    try {
      const region = doSplit ? splitRegion(partIdx) : null;
      const result = await detectCorners(bookId, sourceImage, region);
      if (result.corners) {
        manualCornersRef.current[partIdx] = true;
        updatePart(partIdx, 'corners', result.corners);
        setCropKeys(prev => prev.map((k, i) => i === partIdx ? k + 1 : k));
      } else {
        alert('Nessun contorno trovato automaticamente.');
      }
    } catch (e) {
      console.error('Auto-detect failed:', e);
    } finally {
      setAutoDetecting(false);
    }
  }

  // Step tab definitions
  const steps = [
    { key: 'source', label: 'Sorgente' },
    { key: 'partA', label: doSplit ? 'Parte A' : 'Pagina' },
    ...(doSplit ? [{ key: 'partB', label: 'Parte B' }] : []),
  ];
  const maxStep = steps.length - 1;

  function handleApply() {
    const finalParts = doSplit
      ? [
          { corners: parts[0].corners || regionToCorners(splitRegion(0)) || fullImageCorners(), rotation: parts[0].rotation },
          { corners: parts[1].corners || regionToCorners(splitRegion(1)) || fullImageCorners(), rotation: parts[1].rotation },
        ]
      : [
          { corners: parts[0].corners || fullImageCorners(), rotation: parts[0].rotation },
        ];
    const replaceIds = siblings.length > 0 ? siblings.map(p => p.id) : [page.id];
    onSave({ parts: finalParts, sourceImage, replaceIds, doSplit, direction, splitAt });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const canApply = !!previewImg;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-3 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Editor pagina</h2>
            {provenanceLabel(page) && (
              <p className="text-xs text-gray-500 mt-0.5 truncate" title={provenanceLabel(page)}>
                {provenanceLabel(page)}
              </p>
            )}
            {siblings.length > 1 && (
              <p className="text-xs text-amber-600 mt-0.5">{siblings.length} pagine da questa sorgente</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* Step tabs */}
        <div className="flex items-center gap-1 px-6 pt-2 pb-0 border-b border-gray-100 shrink-0">
          {steps.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setStep(i)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                step === i ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </div>

        {/* Canvas + preview */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Editing canvas (scrollable) */}
          <div className="flex-1 overflow-auto p-4 bg-gray-100 min-w-0">
            {step === 0 && (
              doSplit
                ? <SplitCanvas key={`split-${direction}`} imageUrl={sourceUrl} direction={direction} splitAt={splitAt} onSplitAtChange={setSplitAt} zoom={zoom} />
                : <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Nessun taglio — vai al passo successivo per ritagliare e ruotare</div>
            )}
            {step === 1 && (!previewImg || (doSplit && !partImages[0])) && (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Caricamento...</div>
            )}
            {step === 1 && previewImg && (!doSplit || partImages[0]) && (
              <CropCanvas
                key={`partA-${doSplit}-${direction}-${Math.round(splitAt * 1000)}-${cropKeys[0]}-${doSplit ? Math.round(partImages[0].bbox.w) + 'x' + Math.round(partImages[0].bbox.h) : 'src'}`}
                imageUrl={doSplit ? partImages[0].url : sourceUrl}
                initialCorners={initCornersFor(0)}
                onCornersChange={c => handleUserCornersChange(0, c)}
                zoom={zoom}
              />
            )}
            {step === 2 && (!previewImg || !partImages[1]) && (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Caricamento...</div>
            )}
            {step === 2 && previewImg && partImages[1] && (
              <CropCanvas
                key={`partB-${doSplit}-${direction}-${Math.round(splitAt * 1000)}-${cropKeys[1]}-${Math.round(partImages[1].bbox.w)}x${Math.round(partImages[1].bbox.h)}`}
                imageUrl={partImages[1].url}
                initialCorners={initCornersFor(1)}
                onCornersChange={c => handleUserCornersChange(1, c)}
                zoom={zoom}
              />
            )}
          </div>

          {/* Live preview sidebar */}
          <div className="w-52 shrink-0 border-l border-gray-200 bg-white flex flex-col p-3 gap-4 overflow-auto">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Anteprima output</p>
            {!previewImg && <p className="text-xs text-gray-400">Caricamento...</p>}
            {previewImg && (
              <>
                <OutputPreview
                  img={previewImg}
                  region={previewRegion(0)}
                  rotation={parts[0].rotation}
                  label={doSplit ? 'Pagina A' : 'Pagina'}
                  accent="text-indigo-600"
                  staticUrl={staticPreviewUrl(0)}
                />
                {doSplit && (
                  <OutputPreview
                    img={previewImg}
                    region={previewRegion(1)}
                    rotation={parts[1].rotation}
                    label="Pagina B"
                    accent="text-emerald-600"
                    staticUrl={staticPreviewUrl(1)}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 shrink-0 space-y-2">

          {/* Step 0 controls */}
          {step === 0 && (
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={doSplit}
                  onChange={e => setDoSplit(e.target.checked)}
                  className="rounded"
                />
                Dividi in due pagine
              </label>
              {doSplit && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Direzione:</span>
                  {[['horizontal', '— Sopra / sotto'], ['vertical', '| Sinistra / destra']].map(([val, lbl]) => (
                    <button
                      key={val}
                      onClick={() => setDirection(val)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        direction === val ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 1 controls (part A or single page) */}
          {step === 1 && (
            <div className="flex items-center gap-4 flex-wrap">
              <RotationPicker
                label={doSplit ? 'Rotazione A' : 'Rotazione'}
                value={parts[0].rotation}
                onChange={v => updatePart(0, 'rotation', v)}
                color="indigo"
              />
              <button
                onClick={() => handleAutoDetect(0)}
                disabled={autoDetecting || !previewImg}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {autoDetecting ? '...' : '⊹ Crop automatico'}
              </button>
            </div>
          )}

          {/* Step 2 controls (part B) */}
          {step === 2 && (
            <div className="flex items-center gap-4 flex-wrap">
              <RotationPicker
                label="Rotazione B"
                value={parts[1].rotation}
                onChange={v => updatePart(1, 'rotation', v)}
                color="emerald"
              />
              <button
                onClick={() => handleAutoDetect(1)}
                disabled={autoDetecting || !previewImg}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {autoDetecting ? '...' : '⊹ Crop automatico'}
              </button>
            </div>
          )}

          {/* Zoom slider (always visible) */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-10">Zoom</span>
            <input
              type="range" min="0.5" max="3" step="0.1"
              value={zoom}
              onChange={e => setZoom(parseFloat(e.target.value))}
              className="w-32 accent-indigo-600"
            />
            <span className="text-xs text-gray-500 w-8">{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between shrink-0">
          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
                ← Indietro
              </button>
            )}
            {step < maxStep && (
              <button onClick={() => setStep(s => s + 1)} className="px-3 py-1.5 rounded-lg border border-indigo-300 text-sm text-indigo-600 hover:bg-indigo-50">
                Avanti →
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
              Annulla
            </button>
            <button
              onClick={handleApply}
              disabled={saving || !canApply}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Elaborazione...' : 'Applica'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RotationPicker({ label, value, onChange, color }) {
  const active = color === 'indigo' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-emerald-600 text-white border-emerald-600';
  const labelColor = color === 'indigo' ? 'text-indigo-700' : 'text-emerald-700';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`text-sm font-medium ${labelColor}`}>{label}:</span>
      {[0, 90, 180, 270].map(d => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-2.5 py-1 rounded-lg text-sm font-medium border transition-colors ${
            value === d ? active : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
          }`}
        >
          {d}°
        </button>
      ))}
    </div>
  );
}
