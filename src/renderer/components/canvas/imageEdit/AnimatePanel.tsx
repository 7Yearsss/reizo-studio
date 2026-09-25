import { useState } from 'react';
import { Clapperboard } from 'lucide-react';
import type { CanvasNode } from '../../../../shared/canvas';
import { estimateNodeCost } from '../../../../shared/canvasPricing';
import * as canvasStore from '../../../state/canvasStore';
import { cn } from '../../../lib/cn';
import EditOverlayShell from './EditOverlayShell';

type Duration = '5s' | '10s';
type Ratio = '16:9' | '9:16' | '1:1';

function pickRatio(w: number, h: number): Ratio {
  const r = w / h;
  if (r > 1.3) return '16:9';
  if (r < 0.77) return '9:16';
  return '1:1';
}

export default function AnimatePanel({
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
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<Duration>('5s');
  const [ratio, setRatio] = useState<Ratio | null>(null);
  const [busy, setBusy] = useState(false);

  const resolvedRatio: Ratio = ratio ?? '16:9';
  const cost = estimateNodeCost({ type: 'video', params: { duration, ratio: resolvedRatio } });

  const confirm = async () => {
    setBusy(true);
    try {
      const videoId = await canvasStore.addNode(sessionId, 'video', {
        x: Math.round(node.x + node.w + 80),
        y: Math.round(node.y),
      });
      if (!videoId) {
        onClose();
        return;
      }
      await canvasStore.renameNode(sessionId, videoId, '动态图片');
      await canvasStore.updateNodeParams(sessionId, videoId, {
        prompt: prompt.trim() || '让画面自然地动起来',
        duration,
        ratio: resolvedRatio,
      });
      await canvasStore.connectNodes(sessionId, node.id, videoId, 'image_out', 'start_frame');
      void canvasStore.runNode(sessionId, videoId);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="动态图片"
      confirmLabel="生成视频"
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      confirmHint={`约 ${cost} 点 · 生成一个图生视频节点`}
      extraActions={
        <div className="flex items-center gap-2 pr-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="运动描述（可留空，默认自然动起来）"
            className="w-64 rounded-full border border-line bg-paper-inset px-3 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint"
          />
          <div className="flex items-center gap-0.5 rounded-full border border-line p-0.5">
            {(['5s', '10s'] as Duration[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={cn(
                  'rounded-full px-2 py-1 text-[12px] tabular-nums',
                  duration === d ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink',
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-full border border-line p-0.5">
            {(['16:9', '9:16', '1:1'] as Ratio[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRatio(r)}
                className={cn(
                  'rounded-full px-2 py-1 text-[12px] tabular-nums',
                  resolvedRatio === r ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="relative flex h-full w-full items-center justify-center">
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="max-h-[64vh] max-w-[70vw] rounded-lg shadow-2xl"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (ratio === null && img.naturalWidth && img.naturalHeight) {
              setRatio(pickRatio(img.naturalWidth, img.naturalHeight));
            }
          }}
        />
        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[12px] text-white/90">
          <Clapperboard size={13} />
          将以此图为首帧生成视频
        </div>
      </div>
    </EditOverlayShell>
  );
}
