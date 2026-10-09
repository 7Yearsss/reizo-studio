import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Video } from 'lucide-react';
import { Popover } from 'radix-ui';
import {
  CAMERA_AXES,
  CAMERA_LIMIT,
  cameraFromPreset,
  cameraSummary,
  normalizeCamera,
  type CameraControl,
} from '../../../shared/cameraMotion';
import { CANVAS_VIDEO_CAMERAS } from '../../../shared/canvas';
import { cn } from '../../lib/cn';
import { BubbleSlider } from '../motion/range-slider-bubble';

const PRIMARY = CAMERA_AXES.slice(0, 4); // pan · tilt · zoom · roll
const ADVANCED = CAMERA_AXES.slice(4); // horizontal track · vertical boom

function sameMotion(a: CameraControl, b: CameraControl): boolean {
  const na = normalizeCamera(a);
  const nb = normalizeCamera(b);
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const k of keys) {
    if ((na as Record<string, number>)[k] !== (nb as Record<string, number>)[k]) return false;
  }
  return true;
}

/**
 * Visual camera-motion controller for a video node. Replaces the flat 6-item
 * `<Select>` with direction + intensity per axis (−10..10), plus the legacy
 * presets as one-tap chips. Writes are committed on release, not per tick, so
 * a drag is a single undo entry.
 */
export default function CameraDial({
  value,
  onChange,
  portalBoundary,
  restoreInputFocus,
  disabled = false,
}: {
  value: CameraControl | undefined;
  onChange: (next: CameraControl) => void;
  portalBoundary?: HTMLElement | null;
  restoreInputFocus?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<CameraControl>(value ?? {});
  const closingByEscape = useRef(false);

  // Resync from props while the popover is closed (agent edits, undo, etc.).
  useEffect(() => {
    if (!open) setDraft(value ?? {});
  }, [value, open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const summary = useMemo(() => cameraSummary(open ? draft : value), [open, draft, value]);
  const active = summary !== '默认运镜';

  const commit = (next: CameraControl) => {
    if (disabled) return;
    setDraft(next);
    onChange(normalizeCamera(next));
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
      <button
        type="button"
        disabled={disabled}
        aria-label="可视化运镜控制器"
        onClick={(event) => event.stopPropagation()}
        title="可视化运镜控制器"
        className={cn(
          'flex h-7 max-w-[150px] items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors',
          active
            ? 'border-accent/60 bg-accent/10 text-accent font-medium'
            : 'border-line/70 bg-paper-inset/40 text-ink hover:border-accent hover:bg-paper-inset/70',
        )}
      >
        <Video size={11} className="shrink-0 opacity-70" />
        <span className="truncate">{summary}</span>
      </button>
      </Popover.Trigger>
      <Popover.Portal container={portalBoundary ?? undefined}>
        <Popover.Content side="bottom" align="start" sideOffset={8} collisionBoundary={portalBoundary ?? undefined} collisionPadding={12} updatePositionStrategy="always"
          aria-label="运镜参数" className="nodrag nopan nowheel z-[120] max-h-[var(--radix-popover-content-available-height)] w-64 overflow-y-auto rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-xl outline-none"
          style={portalBoundary ? { maxWidth: Math.max(0, portalBoundary.clientWidth - 24) } : undefined}
          onEscapeKeyDown={() => { closingByEscape.current = true; }}
          onCloseAutoFocus={(event) => { if (closingByEscape.current && restoreInputFocus) { event.preventDefault(); restoreInputFocus(); } closingByEscape.current = false; }}
          onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>

          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-ink">运镜</span>
            <button
              type="button"
              onClick={() => commit({})}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-paper-inset hover:text-ink"
              title="清除全部运镜"
            >
              <RotateCcw size={10} />
              重置
            </button>
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {CANVAS_VIDEO_CAMERAS.map((preset) => {
              const presetCam = cameraFromPreset(preset.id);
              const isActive =
                preset.id === 'none'
                  ? !active
                  : sameMotion(draft, presetCam);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => commit(preset.id === 'none' ? {} : presetCam)}
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-[10px] transition-colors',
                    isActive
                      ? 'bg-accent text-accent-ink font-semibold'
                      : 'bg-paper-inset/60 text-ink-muted hover:bg-paper-inset hover:text-ink',
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            {PRIMARY.map((axis) => (
              <AxisSlider
                key={axis.id}
                axis={axis}
                value={draft[axis.id] ?? 0}
                onDraft={(v) => setDraft((d) => ({ ...d, [axis.id]: v }))}
                onCommit={(v) => commit({ ...draft, [axis.id]: v })}
              />
            ))}

            {showAdvanced
              ? ADVANCED.map((axis) => (
                  <AxisSlider
                    key={axis.id}
                    axis={axis}
                    value={draft[axis.id] ?? 0}
                    onDraft={(v) => setDraft((d) => ({ ...d, [axis.id]: v }))}
                    onCommit={(v) => commit({ ...draft, [axis.id]: v })}
                  />
                ))
              : null}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="mt-2 w-full rounded-md py-1 text-[10px] text-ink-muted hover:bg-paper-inset hover:text-ink"
          >
            {showAdvanced ? '收起轨道运动' : '更多：轨道 / 升降'}
          </button>

          <p className="mt-1.5 text-[10px] leading-snug text-ink-muted/80">
            可灵仅采用主导轴，其余轴自动转为文字描述随提示词下发。
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AxisSlider({
  axis,
  value,
  onDraft,
  onCommit,
}: {
  axis: (typeof CAMERA_AXES)[number];
  value: number;
  onDraft: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[10px] font-medium text-ink">{axis.label}</span>
        <span
          className={cn(
            'rounded px-1 text-[10px] tabular-nums',
            value === 0 ? 'text-ink-muted/60' : 'bg-accent/10 text-accent font-semibold',
          )}
        >
          {value > 0 ? `+${value}` : value}
        </span>
      </div>
      <BubbleSlider
        compact
        bipolar
        min={-CAMERA_LIMIT}
        max={CAMERA_LIMIT}
        step={1}
        value={value}
        onValueChange={onDraft}
        onValueCommit={onCommit}
        onDoubleClick={() => {
          onDraft(0);
          onCommit(0);
        }}
        format={(v) => (v > 0 ? `+${v}` : `${v}`)}
        aria-label={axis.label}
        className="h-6 px-1 pb-0.5"
      />
      <div className="mt-0.5 flex justify-between text-[9px] text-ink-muted/70">
        <span>{axis.negLabel}</span>
        <span>{axis.posLabel}</span>
      </div>
    </div>
  );
}
