import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import type { ImageEditParams } from '../../../../shared/canvasImageEdit';
import { commitImageEdit } from './commitEdit';
import EditOverlayShell from './EditOverlayShell';
import EditPanelCard from './EditPanelCard';
import EditSlider from './EditSlider';
import EditJobStage from './EditJobStage';

type Dir = NonNullable<ImageEditParams['lightDir']>;

const PRESETS: Array<{ id: Dir; label: string; angle: number; radius: number; back?: boolean }> = [
  { id: 'left', label: '左侧', angle: 270, radius: 0.85 },
  { id: 'top', label: '顶部', angle: 0, radius: 0.85 },
  { id: 'right', label: '右侧', angle: 90, radius: 0.85 },
  { id: 'front', label: '前方', angle: 0, radius: 0 },
  { id: 'bottom', label: '底部', angle: 180, radius: 0.85 },
  { id: 'back', label: '后方', angle: 0, radius: 0.85, back: true },
];

/** Continuous dial position -> the 6-way enum the spec stores. */
function resolveDir(angle: number, radius: number, back: boolean): Dir {
  if (back) return 'back';
  if (radius < 0.3) return 'front';
  const a = ((angle % 360) + 360) % 360;
  if (a >= 315 || a < 45) return 'top';
  if (a < 135) return 'right';
  if (a < 225) return 'bottom';
  return 'left';
}

const DIR_LABEL: Record<Dir, string> = {
  left: '左侧',
  top: '顶部',
  right: '右侧',
  front: '前方',
  bottom: '底部',
  back: '后方',
};

export default function RelightPanel({
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
  const [angle, setAngle] = useState(0); // 0 = up, clockwise degrees
  const [radius, setRadius] = useState(0.85); // 0 = front/centre, 1 = grazing
  const [back, setBack] = useState(false);
  const [brightness, setBrightness] = useState(50);
  const [colorTempK, setColorTempK] = useState(5600);
  const [rimLight, setRimLight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const lightDir = resolveDir(angle, radius, back);

  const confirm = async () => {
    setBusy(true);
    try {
      const id = await commitImageEdit('derive', sessionId, node, {
        kind: 'relight',
        params: { brightness, colorTempK, lightDir, rimLight },
      });
      if (id) setJobId(id);
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const setFromEvent = (e: { clientX: number; clientY: number }) => {
    const box = dialRef.current?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const r = Math.min(1, Math.hypot(dx, dy) / (box.width / 2));
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up, clockwise
    setAngle(Math.round(((deg % 360) + 360) % 360));
    setRadius(Number(r.toFixed(2)));
    if (back) setBack(false);
  };

  const reset = () => {
    setAngle(0);
    setRadius(0.85);
    setBack(false);
    setBrightness(50);
    setColorTempK(5600);
    setRimLight(false);
  };

  // dot position inside the dial (px offsets from centre, dial is 200px)
  const rad = (angle * Math.PI) / 180;
  const dotX = Math.sin(rad) * radius * 92;
  const dotY = -Math.cos(rad) * radius * 92;

  const warm = (colorTempK - 2000) / 8000;
  const tempOverlay =
    warm < 0.5 ? `rgba(255, 160, 80, ${(0.5 - warm) * 0.35})` : `rgba(140, 180, 255, ${(warm - 0.5) * 0.3})`;
  const lightWash = back
    ? 'linear-gradient(to top, rgba(180,200,255,0.32), transparent 55%)'
    : radius < 0.3
      ? 'radial-gradient(circle at 50% 42%, rgba(255,244,220,0.5), transparent 70%)'
      : `linear-gradient(${angle + 180}deg, rgba(255,240,214,0.55), transparent 60%)`;

  return (
    <EditOverlayShell
      title="打光"
      confirmLabel="应用打光"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      hideActions={Boolean(jobId)}
    >
      {jobId ? (
        <EditJobStage sessionId={sessionId} jobId={jobId} beforeUrl={imageUrl} onAccept={onClose} onDiscard={onClose} />
      ) : (
        <EditPanelCard className="w-[min(780px,94vw)]">
          {/* Light-direction dial */}
          <div className="flex shrink-0 flex-col items-center gap-3">
            <div
              ref={dialRef}
              className="relative h-[200px] w-[200px] cursor-pointer rounded-full border border-line bg-paper-inset/40"
              style={{
                background:
                  'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--ink) 5%, transparent), transparent 72%)',
              }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                dragging.current = true;
                setFromEvent(e);
              }}
              onPointerMove={(e) => {
                if (dragging.current) setFromEvent(e);
              }}
              onPointerUp={() => {
                dragging.current = false;
              }}
            >
              <span className="pointer-events-none absolute inset-[14%] rounded-full border border-dashed border-line/60" />
              {/* subject thumbnail at centre */}
              <span className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-line">
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                <span className="absolute inset-0" style={{ background: lightWash }} />
              </span>
              {/* light source dot + beam */}
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 h-1 origin-left rounded-full bg-amber-300/50"
                style={{
                  width: Math.hypot(dotX, dotY),
                  transform: `translateY(-50%) rotate(${(Math.atan2(dotY, dotX) * 180) / Math.PI}deg)`,
                }}
              />
              <span
                className={
                  back
                    ? 'pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300 bg-transparent'
                    : 'pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300 shadow-[0_0_14px_4px_rgba(252,211,77,0.55)]'
                }
                style={{ transform: `translate(calc(-50% + ${dotX}px), calc(-50% + ${dotY}px))` }}
              />
            </div>
            <span className="text-[11px] text-ink-muted">
              当前主光 · {DIR_LABEL[lightDir]} · 拖动光点调整
            </span>
          </div>

          {/* Preview + controls */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex items-center gap-4">
              <div
                className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-line"
                style={{
                  filter: `brightness(${0.55 + brightness / 140})`,
                  boxShadow: rimLight ? '0 0 18px 4px rgba(180,220,255,0.45)' : undefined,
                }}
              >
                <img src={imageUrl} alt="" className="h-full w-full object-contain" />
                <span className="pointer-events-none absolute inset-0" style={{ background: lightWash }} />
                <span className="pointer-events-none absolute inset-0" style={{ background: tempOverlay }} />
              </div>
              <div className="flex flex-1 flex-col gap-3">
                <EditSlider label="亮度" value={brightness} display={`${brightness}%`} min={0} max={100} onChange={setBrightness} />
                <EditSlider
                  label="色温"
                  value={colorTempK}
                  display={`${colorTempK}K`}
                  min={2000}
                  max={10000}
                  step={100}
                  onChange={setColorTempK}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 text-[12px] text-ink-muted">快捷方位</div>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setAngle(p.angle);
                      setRadius(p.radius);
                      setBack(Boolean(p.back));
                    }}
                    className={
                      lightDir === p.id
                        ? 'rounded-lg bg-accent/20 py-1.5 text-[12px] text-accent'
                        : 'rounded-lg py-1.5 text-[12px] text-ink-muted hover:bg-paper-inset hover:text-ink'
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-[12px] text-ink-muted">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={rimLight} onChange={(e) => setRimLight(e.target.checked)} />
                轮廓光
              </label>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-paper-inset hover:text-ink"
              >
                <RotateCcw size={13} />
                重置
              </button>
            </div>
          </div>
        </EditPanelCard>
      )}
    </EditOverlayShell>
  );
}
