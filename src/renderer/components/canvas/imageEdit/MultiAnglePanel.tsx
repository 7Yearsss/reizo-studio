import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { commitImageEdit } from './commitEdit';
import EditOverlayShell from './EditOverlayShell';
import EditJobStage from './EditJobStage';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function MultiAnglePanel({
  sessionId,
  node,
  imageUrl,
  onClose,
}: {
  sessionId: string;
  node: CanvasNode;
  imageUrl: string;
  onClose: () => void;
}) {
  const [rotateDeg, setRotateDeg] = useState(0);
  const [tiltDeg, setTiltDeg] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [wideAngle, setWideAngle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; rotate: number; tilt: number } | null>(null);

  const confirm = async () => {
    setBusy(true);
    try {
      const id = await commitImageEdit('derive', sessionId, node, {
        kind: 'multiAngle',
        params: { rotateDeg, tiltDeg, zoom, wideAngle },
      });
      if (id) setJobId(id);
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, rotate: rotateDeg, tilt: tiltDeg };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setRotateDeg(clamp(Math.round(drag.current.rotate + dx * 0.45), -180, 180));
    setTiltDeg(clamp(Math.round(drag.current.tilt - dy * 0.35), -80, 80));
  };
  const onUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    setZoom((z) => clamp(z + (e.deltaY > 0 ? -1 : 1), -10, 10));
  };

  const reset = () => {
    setRotateDeg(0);
    setTiltDeg(0);
    setZoom(0);
  };

  const zoomLabel = zoom === 0 ? '无' : `${zoom > 0 ? '+' : ''}${zoom * 10}%`;
  const dirty = rotateDeg !== 0 || tiltDeg !== 0 || zoom !== 0 || wideAngle;

  return (
    <EditOverlayShell
      title="拖动图片调整视角"
      confirmLabel="生成新视角"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      confirmDisabled={!dirty}
      confirmHint={!dirty ? '先拖动图片换一个角度' : undefined}
      hideActions={Boolean(jobId)}
      extraActions={
        jobId ? null : (
          <div className="flex items-center gap-3 pr-2 text-[12px] tabular-nums text-ink-muted">
            <span>旋转 {rotateDeg}°</span>
            <span>倾斜 {tiltDeg}°</span>
            <span>缩放 {zoomLabel}</span>
            <label className="flex items-center gap-1.5 text-ink">
              <input type="checkbox" checked={wideAngle} onChange={(e) => setWideAngle(e.target.checked)} />
              广角
            </label>
            <button
              type="button"
              onClick={reset}
              title="重置视角"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-ink-muted hover:bg-paper-inset hover:text-ink"
            >
              <RotateCcw size={13} />
              重置
            </button>
          </div>
        )
      }
    >
      {jobId ? (
        <EditJobStage
          sessionId={sessionId}
          jobId={jobId}
          beforeUrl={imageUrl}
          onAccept={onClose}
          onDiscard={onClose}
        />
      ) : (
        <div
          className="turntable-stage relative flex h-full w-full cursor-grab select-none items-center justify-center active:cursor-grabbing"
          style={{ perspective: wideAngle ? 460 : 1100 }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          onWheel={onWheel}
        >
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            className="max-h-[64vh] max-w-[70vw] rounded-lg shadow-2xl"
            style={{
              transform: `rotateX(${-tiltDeg}deg) rotateY(${rotateDeg}deg) scale(${1 + zoom / 22})`,
              transformStyle: 'preserve-3d',
              transition: drag.current ? 'none' : 'transform 120ms ease-out',
            }}
          />
        </div>
      )}
    </EditOverlayShell>
  );
}
