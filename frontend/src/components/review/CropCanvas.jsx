import { useRef, useEffect, useState } from 'react';

const CORNER_R = 10;        // corner handle radius
const EDGE_HS = 7;          // edge handle half-size (square, total 14×14)
const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL'];

// For each edge index 0-3, the two corner indices it connects
const EDGE_CORNERS = [[0, 1], [1, 2], [2, 3], [3, 0]];

/**
 * Interactive canvas with 4 draggable corner handles and 4 edge-midpoint handles.
 *
 * Corner handles  — drag moves a single corner (perspective correction).
 * Edge handles    — drag translates both corners of that edge by the same delta,
 *                   keeping the edge parallel / straight.
 *
 * Props:
 *   imageUrl        — URL of the source image
 *   initialCorners  — [[x,y]×4] in original image space; null → 5% inset default
 *   onCornersChange — (corners in original image space) => void
 *   zoom            — CSS display scale multiplier (default 1)
 */
export default function CropCanvas({ imageUrl, initialCorners, onCornersChange, zoom = 1 }) {
  const canvasRef   = useRef(null);
  const imgRef      = useRef(null);
  const scaleRef    = useRef(1);
  const dragIdxRef  = useRef(-1);   // 0-3 = corner, 4-7 = edge, -1 = none
  const lastPosRef  = useRef([0, 0]);
  const initialCornersRef = useRef(initialCorners);

  const [corners,    setCorners]    = useState(null);
  const [dragIdx,    setDragIdx]    = useState(-1);
  const [canvasDims, setCanvasDims] = useState({ w: 0, h: 0 });

  useEffect(() => { dragIdxRef.current = dragIdx; }, [dragIdx]);

  // Keep ref in sync so remounts (key-based reset) pick up the latest initialCorners
  useEffect(() => { initialCornersRef.current = initialCorners; }, [initialCorners]);

  // ── Load image ────────────────────────────────────────────────────────────
  // Deliberately NOT in [imageUrl, initialCorners] — initialCorners is read via
  // ref to avoid the reset-loop that would occur when onCornersChange fires and
  // the parent updates the prop.  Use a `key` on this component to force a
  // fresh mount when you need to reinitialise with new corners.
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const maxW = Math.min(canvas.parentElement.clientWidth - 2, 700);
      const scale = Math.min(1, maxW / img.naturalWidth);
      scaleRef.current = scale;
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      setCanvasDims({ w: canvas.width, h: canvas.height });

      const ic = initialCornersRef.current;
      let init;
      if (ic && ic.length === 4) {
        init = ic.map(([x, y]) => [x * scale, y * scale]);
      } else {
        const px = 0.05 * canvas.width;
        const py = 0.05 * canvas.height;
        init = [
          [px,                   py],
          [canvas.width  - px,   py],
          [canvas.width  - px,   canvas.height - py],
          [px,                   canvas.height - py],
        ];
      }
      setCorners(init);
    };
    img.onerror = () => console.error('CropCanvas: failed to load', imageUrl);
  }, [imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Redraw ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!corners || !imgRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);

    // Dark overlay outside selection
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clip to selected polygon — shows clear region inside
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...corners[0]);
    corners.slice(1).forEach(c => ctx.lineTo(...c));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Polygon outline
    ctx.beginPath();
    ctx.moveTo(...corners[0]);
    corners.slice(1).forEach(c => ctx.lineTo(...c));
    ctx.closePath();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── Edge handles (squares at midpoints) ──────────────────────────────
    EDGE_CORNERS.forEach(([a, b], ei) => {
      const mx = (corners[a][0] + corners[b][0]) / 2;
      const my = (corners[a][1] + corners[b][1]) / 2;
      const active = dragIdxRef.current === 4 + ei;
      ctx.fillStyle   = active ? '#6366f1' : 'white';
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.rect(mx - EDGE_HS, my - EDGE_HS, EDGE_HS * 2, EDGE_HS * 2);
      ctx.fill();
      ctx.stroke();
      // Arrow hint
      ctx.fillStyle = active ? 'white' : '#6366f1';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ei % 2 === 0 ? '↕' : '↔', mx, my);
    });

    // ── Corner handles (circles) ──────────────────────────────────────────
    corners.forEach(([x, y], i) => {
      const active = dragIdxRef.current === i;
      ctx.beginPath();
      ctx.arc(x, y, CORNER_R, 0, Math.PI * 2);
      ctx.fillStyle   = active ? '#4f46e5' : '#6366f1';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CORNER_LABELS[i], x, y);
    });

    // Notify parent with corners in original image space
    const scale = scaleRef.current;
    onCornersChange?.(corners.map(([x, y]) => [x / scale, y / scale]));
  }, [corners, dragIdx, onCornersChange]);

  // ── Pointer helpers ───────────────────────────────────────────────────────
  function getCanvasPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (canvasRef.current.width  / rect.width),
      (e.clientY - rect.top)  * (canvasRef.current.height / rect.height),
    ];
  }

  function onPointerDown(e) {
    if (!corners) return;
    const [mx, my] = getCanvasPos(e);

    // Corner handles take priority
    const ci = corners.findIndex(([x, y]) => Math.hypot(mx - x, my - y) <= CORNER_R + 4);
    if (ci >= 0) {
      setDragIdx(ci);
      lastPosRef.current = [mx, my];
      canvasRef.current.setPointerCapture(e.pointerId);
      return;
    }

    // Edge handles
    const ei = EDGE_CORNERS.findIndex(([a, b]) => {
      const ex = (corners[a][0] + corners[b][0]) / 2;
      const ey = (corners[a][1] + corners[b][1]) / 2;
      return Math.hypot(mx - ex, my - ey) <= EDGE_HS + 6;
    });
    if (ei >= 0) {
      setDragIdx(4 + ei);
      lastPosRef.current = [mx, my];
      canvasRef.current.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e) {
    if (dragIdxRef.current < 0 || !corners) return;
    const canvas  = canvasRef.current;
    const [mx, my] = getCanvasPos(e);
    const idx      = dragIdxRef.current;

    if (idx < 4) {
      // ── Corner: move to absolute mouse position ─────────────────────────
      setCorners(prev => prev.map((c, i) => i === idx
        ? [Math.max(0, Math.min(canvas.width, mx)), Math.max(0, Math.min(canvas.height, my))]
        : c,
      ));
    } else {
      // ── Edge: translate both connected corners by the same delta ─────────
      const [lx, ly] = lastPosRef.current;
      const dx = mx - lx;
      const dy = my - ly;
      const [ci0, ci1] = EDGE_CORNERS[idx - 4];
      setCorners(prev => {
        const next = prev.map(c => [...c]);
        next[ci0] = [
          Math.max(0, Math.min(canvas.width,  next[ci0][0] + dx)),
          Math.max(0, Math.min(canvas.height, next[ci0][1] + dy)),
        ];
        next[ci1] = [
          Math.max(0, Math.min(canvas.width,  next[ci1][0] + dx)),
          Math.max(0, Math.min(canvas.height, next[ci1][1] + dy)),
        ];
        return next;
      });
    }
    lastPosRef.current = [mx, my];
  }

  function onPointerUp() { setDragIdx(-1); }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        cursor: dragIdx >= 0 ? 'grabbing' : 'crosshair',
        touchAction: 'none',
        display: 'block',
        ...(canvasDims.w
          ? { width: `${canvasDims.w * zoom}px`, height: `${canvasDims.h * zoom}px` }
          : { maxWidth: '100%' }),
      }}
    />
  );
}
