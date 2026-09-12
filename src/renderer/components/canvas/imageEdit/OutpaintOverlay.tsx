import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode } from '../../../../shared/canvas';
import { loadHtmlImage, outpaintMaskBlob } from './pixelOps';
import { commitImageEdit, type EditCommitMode } from './commitEdit';
import { outpaintResultSize } from './editMath';
import EditOverlayShell from './EditOverlayShell';
import EditJobStage from './EditJobStage';

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Handle = (typeof HANDLES)[number];

export default function OutpaintOverlay({
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
  const [nat, setNat] = useState({ w: 1, h: 1 });
  const [disp, setDisp] = useState({ w: 320, h: 320 });
  const [pad, setPad] = useState({ left: 0.12, right: 0.12, top: 0.12, bottom: 0.12 });
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const drag = useRef<{ handle: Handle; startX: number; startY: number; origin: typeof pad } | null>(null);

  useEffect(() => {
    void loadHtmlImage(imageUrl).then((img) => {
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      const maxW = Math.min(640, window.innerWidth * 0.56);
      const maxH = Math.min(520, window.innerHeight * 0.5);
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      setDisp({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    });
  }, [imageUrl]);

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, origin: pad };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.startX) / disp.w;
    const dy = (e.clientY - drag.current.startY) / disp.h;
    const o = drag.current.origin;
    const h = drag.current.handle;
    const next = { ...o };
    if (h.includes('w')) next.left = Math.min(1.5, Math.max(0, o.left - dx));
    if (h.includes('e')) next.right = Math.min(1.5, Math.max(0, o.right + dx));
    if (h.includes('n')) next.top = Math.min(1.5, Math.max(0, o.top - dy));
    if (h.includes('s')) next.bottom = Math.min(1.5, Math.max(0, o.bottom + dy));
    setPad(next);
  };

  const result = outpaintResultSize(nat.w, nat.h, pad);
  const frameW = disp.w * (1 + pad.left + pad.right);
  const frameH = disp.h * (1 + pad.top + pad.bottom);

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
      const maskBlob = await outpaintMaskBlob(nat.w, nat.h, pad);
      const id = await commitImageEdit(commitMode, sessionId, node, { kind: 'outpaint', params: { pad } }, { maskBlob });
      if (id) setJobId(id);
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="扩图"
      confirmLabel="确认扩图"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      hideActions={Boolean(jobId)}
    >
      {jobId ? (
        <EditJobStage
          sessionId={sessionId}
          jobId={jobId}
          beforeUrl={imageUrl}
          onAccept={onClose}
          onDiscard={onClose}
          allowDelete={commitMode !== 'revise'}
        />
      ) : (
        <div className="flex flex-col items-center gap-3" onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }}>
          <div
            ref={wrapRef}
            className="relative canvas-checker"
            style={{ width: frameW, height: frameH }}
          >
            <div className="absolute inset-0 border border-dashed border-accent/70" />
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute object-contain"
              style={{
                left: pad.left * disp.w,
                top: pad.top * disp.h,
                width: disp.w,
                height: disp.h,
              }}
            />
            {HANDLES.map((h) => (
              <span
                key={h}
                className="absolute z-10 h-3 w-3 rounded-[2px] border border-paper-raised bg-accent"
                style={handleStyle[h]}
                onPointerDown={onPointerDown(h)}
              />
            ))}
          </div>
          <p className="text-[12px] tabular-nums text-ink-muted">
            结果 ≈ {result.w} × {result.h}
            <span className="ml-2">
              左 {Math.round(pad.left * 100)}% · 右 {Math.round(pad.right * 100)}% · 上 {Math.round(pad.top * 100)}% · 下 {Math.round(pad.bottom * 100)}%
            </span>
          </p>
        </div>
      )}
    </EditOverlayShell>
  );
}
