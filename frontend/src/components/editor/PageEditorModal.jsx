import { useState, useEffect, useRef, useMemo } from 'react';
import CropCanvas from '../review/CropCanvas';
import SplitCanvas from './SplitCanvas';
import { detectCorners } from '../../api/client';

const SPLIT_METHODS = new Set(['vertical_split', 'spread_split', 'no_contour_spread', 'manual_split']);

function inferDirection(meta) {
  if (!meta) return 'horizontal';
  if (meta.split_direction) return meta.split_direction;
  if (meta.method === 'spread_split' || meta.method === 'no_contour_spread') return 'vertical';
  return 'horizontal';
}

// Restore previous state from page meta + siblings
function initFromMeta(page, siblings) {
  const meta = page.processing_meta || {};
  const isSplit = SPLIT_METHODS.has(meta.method);

  if (isSplit) {
    const allMeta = siblings.map(s => s.processing_meta || {});
    const aMeta = allMeta.find(m => m.split_from === 'top' || m.split_from === 'left') || {};
    const bMeta = allMeta.find(m => m.split_from === 'bottom' || m.split_from === 'right') || {};
    return {
      doSplit: true,
      direction: inferDirection(meta),
      splitAt: meta.split_at ?? 0.5,
      parts: [
        { rotation: aMeta.rotation ?? aMeta.auto_rotation_deg ?? 0, corners: aMeta.contour_pts ?? null },
        { rotation: bMeta.rotation ?? bMeta.auto_rotation_deg ?? 0, corners: bMeta.contour_pts ?? null },
      ],
    };
  }

  return {
    doSplit: false,
    direction: 'horizontal',
    splitAt: 0.5,
    parts: [
      { rotation: meta.rotation ?? meta.auto_rotation_deg ?? 0, corners: meta.contour_pts ?? null },
      { rotation: 0, corners: null },
    ],
  };
}

// ---------------------------------------------------------------------------
// OutputPreview — live canvas rendering a region of the source image, rotated
// ---------------------------------------------------------------------------
function OutputPreview({ img, region, rotation, label, accent }) {
  const canvasRef = useRef(null);

  useEffect(() => {
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
  }, [img, region, rotation]);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[11px] font-semibold ${accent}`}>{label}</span>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', border: '1px solid #e5e7eb', borderRadius: 4, display: 'block' }} />
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

  // Track the split params that were in effect when corners were last initialised,
  // so we only reset corners when the user actually changes the split (not on mount).
  const prevSplitRef = useRef({ splitAt: init.splitAt, direction: init.direction });

  const sourceImage = page.source_image || page.source_file;
  const sourceUrl = sourceImage ? `/${sourceImage}` : `/${page.processed_file}`;

  // Load image for preview rendering
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setPreviewImg(img);
    img.src = sourceUrl;
  }, [sourceUrl]);

  // Reset part corners when the split line moves, but not on mount (restored corners survive).
  useEffect(() => {
    const prev = prevSplitRef.current;
    if (prev.splitAt === splitAt && prev.direction === direction) return;
    prevSplitRef.current = { splitAt, direction };
    setParts(prev => prev.map(p => ({ ...p, corners: null })));
  }, [splitAt, direction]);

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

  // Corners to show in CropCanvas for a given part
  function initCornersFor(idx) {
    if (parts[idx].corners) return parts[idx].corners;
    if (doSplit) return regionToCorners(splitRegion(idx));
    return null; // CropCanvas defaults to 5% inset
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

  async function handleAutoDetect(partIdx) {
    if (!previewImg || !sourceImage) return;
    setAutoDetecting(true);
    try {
      const region = doSplit ? splitRegion(partIdx) : null;
      const result = await detectCorners(bookId, sourceImage, region);
      if (result.corners) {
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
          <div>
            <h2 className="text-base font-semibold text-gray-900">Editor pagina</h2>
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
            {step === 1 && !previewImg && (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Caricamento...</div>
            )}
            {step === 1 && previewImg && (
              <CropCanvas
                key={`partA-${doSplit}-${direction}-${Math.round(splitAt * 1000)}-${cropKeys[0]}`}
                imageUrl={sourceUrl}
                initialCorners={initCornersFor(0)}
                onCornersChange={c => updatePart(0, 'corners', c)}
                zoom={zoom}
              />
            )}
            {step === 2 && !previewImg && (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Caricamento...</div>
            )}
            {step === 2 && previewImg && (
              <CropCanvas
                key={`partB-${doSplit}-${direction}-${Math.round(splitAt * 1000)}-${cropKeys[1]}`}
                imageUrl={sourceUrl}
                initialCorners={initCornersFor(1)}
                onCornersChange={c => updatePart(1, 'corners', c)}
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
                />
                {doSplit && (
                  <OutputPreview
                    img={previewImg}
                    region={previewRegion(1)}
                    rotation={parts[1].rotation}
                    label="Pagina B"
                    accent="text-emerald-600"
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
