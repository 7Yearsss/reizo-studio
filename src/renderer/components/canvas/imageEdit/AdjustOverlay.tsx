import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { commitImageEdit, type EditCommitMode } from './commitEdit';
import { adjustCssFilter, adjustImageBlob, type AdjustSpec } from './pixelOps';
import EditOverlayShell from './EditOverlayShell';
import EditPanelCard from './EditPanelCard';
import EditSlider from './EditSlider';

export default function AdjustOverlay({
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
  const [spec, setSpec] = useState<Required<AdjustSpec>>({ brightness: 1, contrast: 1, saturation: 1, warmth: 0, hueDeg: 0 });
  const [busy, setBusy] = useState(false);

  const changed = spec.brightness !== 1 || spec.contrast !== 1 || spec.saturation !== 1 || spec.warmth !== 0 || spec.hueDeg !== 0;
  const set = (patch: Partial<AdjustSpec>) => setSpec((s) => ({ ...s, ...patch }));

  const confirm = async () => {
    if (!changed) return;
    setBusy(true);
    try {
      const blob = await adjustImageBlob(imageUrl, spec);
      await commitImageEdit(
        commitMode,
        sessionId,
        node,
        {
          kind: 'adjust',
          params: {
            brightness: spec.brightness,
            contrast: spec.contrast,
            saturation: spec.saturation,
            warmth: spec.warmth,
            hueDeg: spec.hueDeg,
          },
        },
        { localResultBlob: blob },
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="调色"
      confirmLabel="应用"
      confirmDisabled={!changed}
      confirmHint="先调整参数"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      extraActions={
        <button
          type="button"
          aria-label="重置"
          title="重置"
          onClick={() => setSpec({ brightness: 1, contrast: 1, saturation: 1, warmth: 0, hueDeg: 0 })}
          className="rounded-full p-1.5 text-ink-muted hover:bg-paper-inset hover:text-ink"
        >
          <RotateCcw size={13} />
        </button>
      }
    >
      <EditPanelCard className="max-w-[86vw] items-start">
        <div className="flex max-h-[56vh] items-center justify-center overflow-hidden rounded-lg bg-canvas-inset">
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            className="max-h-[56vh] max-w-[46vw] object-contain"
            style={{ filter: adjustCssFilter(spec) }}
          />
        </div>
        <div className="flex w-64 flex-col gap-3.5">
          <EditSlider label="亮度" value={spec.brightness} display={`${Math.round(spec.brightness * 100)}%`} min={0.4} max={1.8} step={0.01} onChange={(v) => set({ brightness: v })} />
          <EditSlider label="对比度" value={spec.contrast} display={`${Math.round(spec.contrast * 100)}%`} min={0.4} max={1.8} step={0.01} onChange={(v) => set({ contrast: v })} />
          <EditSlider label="饱和度" value={spec.saturation} display={`${Math.round(spec.saturation * 100)}%`} min={0} max={2} step={0.01} onChange={(v) => set({ saturation: v })} />
          <EditSlider label="色温" value={spec.warmth} display={spec.warmth === 0 ? '中性' : `${Math.round(spec.warmth * 100)}`} min={-0} max={1} step={0.01} onChange={(v) => set({ warmth: v })} />
          <EditSlider label="色相" value={spec.hueDeg} display={`${spec.hueDeg}°`} min={-180} max={180} step={1} onChange={(v) => set({ hueDeg: v })} />
        </div>
      </EditPanelCard>
    </EditOverlayShell>
  );
}
