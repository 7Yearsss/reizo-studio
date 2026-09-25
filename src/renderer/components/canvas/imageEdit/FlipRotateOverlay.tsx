import { useState } from 'react';
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { commitImageEdit, type EditCommitMode } from './commitEdit';
import { transformImageBlob } from './pixelOps';
import EditOverlayShell from './EditOverlayShell';
import EditPanelCard from './EditPanelCard';
import { cn } from '../../../lib/cn';

export default function FlipRotateOverlay({
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
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [deg, setDeg] = useState(0);
  const [busy, setBusy] = useState(false);

  const changed = flipH || flipV || deg !== 0;

  const confirm = async () => {
    if (!changed) return;
    setBusy(true);
    try {
      const blob = await transformImageBlob(imageUrl, { flipH, flipV, rotateDeg: deg });
      await commitImageEdit(commitMode, sessionId, node, { kind: 'flip', params: { flipH, flipV, rotateDeg: deg } }, { localResultBlob: blob });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="翻转/旋转"
      confirmLabel="应用"
      confirmDisabled={!changed}
      confirmHint="先选择翻转或旋转"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
    >
      <EditPanelCard className="max-w-[86vw] flex-col items-center gap-4">
        <div className="flex max-h-[56vh] items-center justify-center overflow-hidden rounded-lg bg-canvas-inset">
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            className="max-h-[56vh] max-w-[70vw] object-contain transition-transform duration-200"
            style={{
              transform: `rotate(${deg}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <ToolBtn active={flipH} title="水平翻转" onClick={() => setFlipH((v) => !v)}><FlipHorizontal2 size={16} /></ToolBtn>
          <ToolBtn active={flipV} title="垂直翻转" onClick={() => setFlipV((v) => !v)}><FlipVertical2 size={16} /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-line" />
          <ToolBtn title="逆时针 90°" onClick={() => setDeg((d) => (d + 270) % 360)}><RotateCcw size={16} /></ToolBtn>
          <ToolBtn title="顺时针 90°" onClick={() => setDeg((d) => (d + 90) % 360)}><RotateCw size={16} /></ToolBtn>
          {deg !== 0 ? <span className="w-10 text-center text-[12px] tabular-nums text-ink-muted">{deg}°</span> : null}
        </div>
      </EditPanelCard>
    </EditOverlayShell>
  );
}

function ToolBtn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg text-ink transition-colors active:scale-95',
        active ? 'bg-accent/20 text-accent' : 'bg-paper-inset hover:bg-line',
      )}
    >
      {children}
    </button>
  );
}
