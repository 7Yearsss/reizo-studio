import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Loader2, Play } from 'lucide-react';
import type { CanvasImageParams, CanvasNode } from '../../../shared/canvas';
import { CANVAS_IMAGE_SIZES } from '../../../shared/canvas';
import { canvasAssetUrl } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';

export interface CanvasNodeData extends Record<string, unknown> {
  sessionId: string;
  node: CanvasNode;
}

function AssetImage({ rel }: { rel: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    void canvasAssetUrl(rel).then((u) => ok && setUrl(u));
    return () => {
      ok = false;
    };
  }, [rel]);
  if (!url) return null;
  return <img src={url} alt="" className="w-full rounded-lg border border-line object-contain" />;
}

export default function ImageNode({ data, selected }: NodeProps) {
  const { sessionId, node } = data as CanvasNodeData;
  const params = node.params as CanvasImageParams;
  const [prompt, setPrompt] = useState(params.prompt ?? '');
  const size = params.size ?? '1024x1024';
  const running = node.runState === 'running';

  useEffect(() => {
    setPrompt((params.prompt as string) ?? '');
  }, [params.prompt]);

  const commitPrompt = () => {
    if (prompt === params.prompt) return;
    void canvasStore.updateNodeParams(sessionId, node.id, { ...params, prompt });
  };

  const run = () => {
    if (running) return;
    if (!prompt.trim()) return;
    if (!window.confirm('生成图片会调用付费接口，确认继续？')) return;
    if (prompt !== params.prompt) {
      void canvasStore
        .updateNodeParams(sessionId, node.id, { ...params, prompt })
        .then(() => canvasStore.runNode(sessionId, node.id, true));
    } else {
      void canvasStore.runNode(sessionId, node.id, true);
    }
  };

  return (
    <div
      className={cn(
        'w-[300px] rounded-xl border bg-paper-raised p-3 text-xs shadow-sm',
        selected ? 'border-accent' : 'border-line',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-line !bg-paper" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-line !bg-accent" />

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-ink-muted">{node.title || '图片'}</span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px]',
            node.runState === 'error'
              ? 'bg-danger/10 text-danger'
              : node.runState === 'done'
                ? 'bg-success/10 text-success'
                : running
                  ? 'bg-accent/10 text-accent'
                  : 'bg-paper-inset text-ink-muted',
          )}
        >
          {node.runState === 'idle' ? '未运行' : node.runState === 'running' ? '生成中' : node.runState === 'done' ? '完成' : '失败'}
        </span>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={commitPrompt}
        rows={3}
        placeholder="描述你想要的图片…"
        className="nodrag w-full resize-none rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
      />

      <div className="mt-2 flex items-center gap-2">
        <select
          value={size}
          onChange={(e) =>
            void canvasStore.updateNodeParams(sessionId, node.id, {
              ...params,
              size: e.target.value as CanvasImageParams['size'],
            })
          }
          className="nodrag rounded-lg border border-line bg-paper px-1.5 py-1 text-[11px] text-ink outline-none"
        >
          {CANVAS_IMAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={run}
          disabled={running || !prompt.trim()}
          className="nodrag ml-auto inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] text-paper-raised disabled:opacity-40"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          运行
        </button>
      </div>

      {node.output?.error ? (
        <p className="mt-2 rounded-lg bg-danger/10 px-2 py-1 text-[11px] text-danger">{node.output.error}</p>
      ) : null}
      {node.output?.assets?.length ? (
        <div className="mt-2 space-y-2">
          {node.output.assets.map((rel) => (
            <AssetImage key={rel} rel={rel} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
