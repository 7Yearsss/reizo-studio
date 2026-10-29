import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clampZoom, exceedsPanThreshold, offsetForZoom, zoomByWheel, ZOOM_STEP, type Point } from '../../../shared/zoomPan';

/**
 * Full-viewport image preview. Wheel / +− zoom (0.25–4×, toward the cursor), drag to pan once the pointer
 * moves past a few pixels, double-click or 0 to reset. Click the backdrop or press Esc to close.
 */
export default function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number; origin: Point; moved: boolean } | null>(null);
  const justPanned = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  function zoomTo(next: number, cursor: Point = { x: 0, y: 0 }) {
    const to = clampZoom(next);
    if (to === scale) return;
    setOffset((current) => (to === 1 ? { x: 0, y: 0 } : offsetForZoom(current, cursor, scale, to)));
    setScale(to);
  }
  const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomTo(scale + ZOOM_STEP);
      else if (e.key === '-') zoomTo(scale - ZOOM_STEP);
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // React's onWheel is passive; the page must not scroll behind the overlay.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomTo(zoomByWheel(scale, e.deltaY), { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return createPortal(
    <div
      ref={stageRef}
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-black/80 p-8"
      onClick={() => {
        if (justPanned.current) { justPanned.current = false; return; }
        onClose();
      }}
    >
      <button
        type="button"
        aria-label="关闭"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X size={18} />
      </button>
      {scale !== 1 && (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs tabular-nums text-white" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
      )}
      <img
        src={src}
        alt=""
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={reset}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          justPanned.current = false;
          drag.current = { x: e.clientX, y: e.clientY, origin: offset, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && !exceedsPanThreshold(dx, dy)) return;
          d.moved = true;
          setPanning(true);
          setOffset({ x: d.origin.x + dx, y: d.origin.y + dy });
        }}
        onPointerUp={() => {
          if (drag.current?.moved) justPanned.current = true;
          drag.current = null;
          setPanning(false);
        }}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, cursor: panning ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in' }}
        className="max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
      />
    </div>,
    document.body,
  );
}
