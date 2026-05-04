import { useRef, useEffect, useState } from 'react';

/**
 * Canvas showing a source image with a draggable split line.
 *
 * Props:
 *   imageUrl        — URL to display
 *   direction       — 'horizontal' (top/bottom) | 'vertical' (left/right)
 *   splitAt         — 0.0–1.0, position of the split along the axis
 *   onSplitAtChange — (ratio: number) => void, called while dragging
 *   zoom            — display scale multiplier (default 1)
 */
export default function SplitCanvas({ imageUrl, direction, splitAt, onSplitAtChange, zoom = 1 }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const stateRef = useRef({ splitAt, direction, dragging: false });
  const [canvasDims, setCanvasDims] = useState({ w: 0, h: 0 });

  useEffect(() => { stateRef.current.splitAt = splitAt; }, [splitAt]);
  useEffect(() => { stateRef.current.direction = direction; }, [direction]);

  function repaint() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const { splitAt: s, direction: dir } = stateRef.current;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);

    const splitPx = dir === 'horizontal' ? ch * s : cw * s;

    // Half tints
    ctx.fillStyle = 'rgba(99,102,241,0.18)';
    if (dir === 'horizontal') ctx.fillRect(0, 0, cw, splitPx);
    else ctx.fillRect(0, 0, splitPx, ch);

    ctx.fillStyle = 'rgba(16,185,129,0.18)';
    if (dir === 'horizontal') ctx.fillRect(0, splitPx, cw, ch - splitPx);
    else ctx.fillRect(splitPx, 0, cw - splitPx, ch);

    // Dashed split line
    ctx.beginPath();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]);
    if (dir === 'horizontal') { ctx.moveTo(0, splitPx); ctx.lineTo(cw, splitPx); }
    else { ctx.moveTo(splitPx, 0); ctx.lineTo(splitPx, ch); }
    ctx.stroke();
    ctx.setLineDash([]);

    // Drag handle
    const hx = dir === 'horizontal' ? cw / 2 : splitPx;
    const hy = dir === 'horizontal' ? splitPx : ch / 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // ↕ or ↔ glyph
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dir === 'horizontal' ? '↕' : '↔', hx, hy);

    // A / B labels
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 5;
    ctx.font = 'bold 18px sans-serif';

    ctx.fillStyle = '#6366f1';
    ctx.fillText('A',
      dir === 'horizontal' ? 26 : splitPx / 2,
      dir === 'horizontal' ? Math.max(splitPx / 2, 22) : 26,
    );

    ctx.fillStyle = '#10b981';
    ctx.fillText('B',
      dir === 'horizontal' ? 26 : splitPx + (cw - splitPx) / 2,
      dir === 'horizontal' ? splitPx + Math.max((ch - splitPx) / 2, 22) : 26,
    );

    ctx.shadowBlur = 0;
  }

  // Load image once
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxW = Math.min((canvas.parentElement?.clientWidth || 700) - 8, 700);
      const scale = Math.min(1, maxW / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      setCanvasDims({ w: canvas.width, h: canvas.height });
      repaint();
    };
  }, [imageUrl]);

  // Repaint whenever split position or direction changes
  useEffect(() => { repaint(); }, [splitAt, direction]);

  function getPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function onPointerDown(e) {
    const canvas = canvasRef.current;
    const { x, y } = getPos(e);
    const dir = stateRef.current.direction;
    const linePos = dir === 'horizontal'
      ? canvas.height * stateRef.current.splitAt
      : canvas.width * stateRef.current.splitAt;
    const hitPos = dir === 'horizontal' ? y : x;
    if (Math.abs(hitPos - linePos) <= 22) {
      stateRef.current.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e) {
    if (!stateRef.current.dragging) return;
    const canvas = canvasRef.current;
    const { x, y } = getPos(e);
    const dir = stateRef.current.direction;
    const ratio = dir === 'horizontal'
      ? Math.max(0.1, Math.min(0.9, y / canvas.height))
      : Math.max(0.1, Math.min(0.9, x / canvas.width));
    stateRef.current.splitAt = ratio;
    onSplitAtChange(ratio);
    repaint();
  }

  function onPointerUp() {
    stateRef.current.dragging = false;
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        cursor: direction === 'horizontal' ? 'row-resize' : 'col-resize',
        touchAction: 'none',
        display: 'block',
        ...(canvasDims.w
          ? { width: `${canvasDims.w * zoom}px`, height: `${canvasDims.h * zoom}px` }
          : { maxWidth: '100%' }),
      }}
    />
  );
}
