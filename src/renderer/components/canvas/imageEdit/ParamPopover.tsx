import { useEffect, useState } from 'react';
import type { CanvasNode } from '../../../../shared/canvas';
import * as canvasStore from '../../../state/canvasStore';
import { loadHtmlImage, resizeImageBlob, splitImageBlobs } from './pixelOps';
import { commitImageEdit, type EditCommitMode } from './commitEdit';
import EditOverlayShell from './EditOverlayShell';
import EditPanelCard from './EditPanelCard';
import EditSlider from './EditSlider';
import EditJobStage from './EditJobStage';

export default function ParamPopover({
  sessionId,
  node,
  imageUrl,
  kind,
  commitMode = 'derive',
  onClose,
}: {
  sessionId: string;
  node: CanvasNode;
  imageUrl: string;
  kind: 'resize' | 'enhance' | 'split';
  commitMode?: EditCommitMode;
  onClose: () => void;
}) {
  if (kind === 'resize') {
    return (
      <ResizePanel
        sessionId={sessionId}
        node={node}
        imageUrl={imageUrl}
        commitMode={commitMode}
        onClose={onClose}
      />
    );
  }
  if (kind === 'enhance') return <EnhancePanel sessionId={sessionId} node={node} imageUrl={imageUrl} onClose={onClose} />;
  return <SplitPanel sessionId={sessionId} node={node} imageUrl={imageUrl} onClose={onClose} />;
}

function ResizePanel({
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
  const [w, setW] = useState(1024);
  const [h, setH] = useState(1024);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadHtmlImage(imageUrl).then((img) => {
      setW(img.naturalWidth);
      setH(img.naturalHeight);
    });
  }, [imageUrl]);

  const confirm = async () => {
    setBusy(true);
    try {
      const blob = await resizeImageBlob(imageUrl, Math.max(1, w), Math.max(1, h));
      await commitImageEdit(
        commitMode,
        sessionId,
        node,
        { kind: 'resize', params: { targetW: w, targetH: h } },
        { localResultBlob: blob },
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell title="调整像素" confirmLabel="确认缩放" onClose={onClose} onConfirm={() => void confirm()} confirming={busy}>
      <EditPanelCard className="w-80 flex-col gap-3">
        <label className="flex items-center justify-between gap-3">
          宽
          <input
            type="number"
            min={1}
            value={w}
            onChange={(e) => setW(Number(e.target.value))}
            className="w-28 rounded-md border border-line bg-paper-inset/40 px-2 py-1"
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          高
          <input
            type="number"
            min={1}
            value={h}
            onChange={(e) => setH(Number(e.target.value))}
            className="w-28 rounded-md border border-line bg-paper-inset/40 px-2 py-1"
          />
        </label>
        <div className="flex gap-2">
          {[0.5, 1, 2].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setW((v) => Math.round(v * m));
                setH((v) => Math.round(v * m));
              }}
              className="flex-1 rounded-lg bg-paper-inset py-1 text-[12px] hover:bg-line"
            >
              {m}×
            </button>
          ))}
        </div>
      </EditPanelCard>
    </EditOverlayShell>
  );
}

function EnhancePanel({
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
  const [scale, setScale] = useState<2 | 4>(2);
  const [strength, setStrength] = useState(50);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    try {
      const id = await commitImageEdit('derive', sessionId, node, { kind: 'enhance', params: { scale, strength } });
      if (id) setJobId(id);
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="增强"
      confirmLabel="开始增强"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      hideActions={Boolean(jobId)}
    >
      {jobId ? (
        <EditJobStage sessionId={sessionId} jobId={jobId} beforeUrl={imageUrl} onAccept={onClose} onDiscard={onClose} />
      ) : (
        <EditPanelCard className="w-80 flex-col gap-4">
          <div className="flex gap-2">
            {([2, 4] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScale(s)}
                className={
                  scale === s
                    ? 'flex-1 rounded-lg bg-accent/20 py-1.5 text-accent'
                    : 'flex-1 rounded-lg bg-paper-inset py-1.5 text-ink-muted'
                }
              >
                {s}×
              </button>
            ))}
          </div>
          <EditSlider label="强度" value={strength} display={`${strength}`} min={0} max={100} onChange={setStrength} />
        </EditPanelCard>
      )}
    </EditOverlayShell>
  );
}

function SplitPanel({
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
  const [grid, setGrid] = useState<'2x2' | '3x3' | '4x4'>('2x2');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      const tiles = await splitImageBlobs(imageUrl, grid);
      await canvasStore.deriveImageSplit(sessionId, node.id, grid, tiles);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell title="快速切分" confirmLabel="切分" onClose={onClose} onConfirm={() => void confirm()} confirming={busy}>
      <EditPanelCard className="w-72 gap-2">
        {(['2x2', '3x3', '4x4'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGrid(g)}
            className={
              grid === g
                ? 'flex-1 rounded-lg bg-accent/20 py-2 text-accent'
                : 'flex-1 rounded-lg bg-paper-inset py-2 text-ink-muted'
            }
          >
            {g.replace('x', '×')}
          </button>
        ))}
      </EditPanelCard>
    </EditOverlayShell>
  );
}
