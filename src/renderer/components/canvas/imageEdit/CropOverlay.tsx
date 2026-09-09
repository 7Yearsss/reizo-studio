import { useCallback, useMemo, useRef, useState } from 'react';
import type { CanvasNode } from '../../../../shared/canvas';
import { cropImageBlob } from './pixelOps';
import { commitImageEdit, type EditCommitMode } from './commitEdit';
import EditOverlayShell from './EditOverlayShell';

type Aspect = 'free' | '1:1' | '4:3' | '3:4' | '16:9';

const ASPECTS: Array<{ id: Aspect; label: string; ratio: number | null }> = [
  { id: 'free', label: '自由', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Handle = (typeof HANDLES)[number];

export default function CropOverlay({
  sessionId,
  node,
  imageUrl,
  commitMode = 'derive',
  onClose,
}: {
  sessionId: string;
  node: CanvasNode;
  imageUrl: string;
  commitMode?: EditCommitMode;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState<Aspect>('free');
  const [rect, setRect] = useState({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ handle: Handle | 'move'; startX: number; startY: number; origin: typeof rect } | null>(null);

  const applyAspect = useCallback((next: typeof rect, ratio: number | null, anchor: Handle | 'move') => {
    if (!ratio) return next;
    const { x, y } = next;
    let { w, h } = next;
    const fromWidth = anchor === 'n' || anchor === 's' ? false : true;
    if (fromWidth) h = w / ratio;
    else w = h * ratio;
    if (x + w > 1) {
      w = 1 - x;
      h = w / ratio;
    }
    if (y + h > 1) {
      h = 1 - y;
      w = h * ratio;
    }
    if (w < 0.04) {
      w = 0.04;
      h = w / ratio;
    }
    if (h < 0.04) {
      h = 0.04;
      w = h * ratio;
    }
    return { x, y, w, h };
  }, []);

  const onPointerDown = (handle: Handle | 'move') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, origin: rect };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !wrapRef.current) return;
    const box = wrapRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.startX) / box.width;
    const dy = (e.clientY - drag.current.startY) / box.height;
    const o = drag.current.origin;
    let next = { ...o };
    const h = drag.current.handle;
    if (h === 'move') {
      next.x = Math.min(1 - o.w, Math.max(0, o.x + dx));
      next.y = Math.min(1 - o.h, Math.max(0, o.y + dy));
    } else {
      if (h.includes('w')) {
        const x = Math.min(o.x + o.w - 0.04, Math.max(0, o.x + dx));
        next.w = o.x + o.w - x;
        next.x = x;
      }
      if (h.includes('e')) next.w = Math.min(1 - o.x, Math.max(0.04, o.w + dx));
      if (h.includes('n')) {
        const y = Math.min(o.y + o.h - 0.04, Math.max(0, o.y + dy));
        next.h = o.y + o.h - y;
        next.y = y;
      }
      if (h.includes('s')) next.h = Math.min(1 - o.y, Math.max(0.04, o.h + dy));
    }
    const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? null;
    next = applyAspect(next, ratio, h);
    setRect(next);
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const handleStyle = useMemo(
    (): Record<Handle, React.CSSProperties> => ({
      n: { left: '50%', top: 0, transform: 'translate(-50%, -50%)', cursor: 'ns-resize' },
      s: { left: '50%', top: '100%', transform: 'translate(-50%, -50%)', cursor: 'ns-resize' },
      e: { left: '100%', top: '50%', transform: 'translate(-50%, -50%)', cursor: 'ew-resize' },
      w: { left: 0, top: '50%', transform: 'translate(-50%, -50%)', cursor: 'ew-resize' },
      ne: { left: '100%', top: 0, transform: 'translate(-50%, -50%)', cursor: 'nesw-resize' },
      nw: { left: 0, top: 0, transform: 'translate(-50%, -50%)', cursor: 'nwse-resize' },
      se: { left: '100%', top: '100%', transform: 'translate(-50%, -50%)', cursor: 'nwse-resize' },
      sw: { left: 0, top: '100%', transform: 'translate(-50%, -50%)', cursor: 'nesw-resize' },
    }),
    [],
  );

  const confirm = async () => {
    setBusy(true);
    try {
      const blob = await cropImageBlob(imageUrl, rect);
      await commitImageEdit(
        commitMode,
        sessionId,
        node,
        { kind: 'crop', cropRect: rect },
        { localResultBlob: blob },
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="裁剪"
      confirmLabel="确认裁剪"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      extraActions={
        <div className="flex items-center gap-1 pr-1">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setAspect(a.id);
                if (a.ratio) setRect((r) => applyAspect(r, a.ratio, 'e'));
              }}
              className={
                aspect === a.id
                  ? 'rounded-full bg-white/20 px-2 py-1 text-[11px] text-white'
                  : 'rounded-full px-2 py-1 text-[11px] text-white/60 hover:text-white'
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      }
    >
      <div
        ref={wrapRef}
        className="relative max-h-[72vh] max-w-[72vw] overflow-hidden select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img src={imageUrl} alt="" draggable={false} className="max-h-[72vh] max-w-[72vw] object-contain" />
        <div
          className="absolute box-border border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
          }}
          onPointerDown={onPointerDown('move')}
        >
          <div className="pointer-events-auto absolute inset-0 cursor-move" onPointerDown={onPointerDown('move')} />
          {HANDLES.map((h) => (
            <span
              key={h}
              className="pointer-events-auto absolute h-3 w-3 rounded-[2px] border border-white bg-white"
              style={handleStyle[h]}
              onPointerDown={onPointerDown(h)}
            />
          ))}
        </div>
      </div>
    </EditOverlayShell>
  );
}
