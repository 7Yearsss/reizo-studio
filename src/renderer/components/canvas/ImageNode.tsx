import { useEffect, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { Download, FolderPlus, Loader2, Play } from 'lucide-react';
import type { CanvasImageParams, CanvasNode } from '../../../shared/canvas';
import { CANVAS_IMAGE_SIZES } from '../../../shared/canvas';
import { canvasAssetUrl } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';
import Lightbox from './Lightbox';

export interface CanvasNodeData extends Record<string, unknown> {
  sessionId: string;
  node: CanvasNode;
}

function useAssetUrl(rel: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!rel) return;
    let ok = true;
    void canvasAssetUrl(rel).then((u) => ok && setUrl(u));
    return () => {
      ok = false;
    };
  }, [rel]);
  return url;
}

export default function ImageNode({ id, data, selected }: NodeProps) {
  const { sessionId, node } = data as CanvasNodeData;
  const params = node.params as CanvasImageParams;
  const [prompt, setPrompt] = useState(params.prompt ?? '');
  const [zoom, setZoom] = useState<string | null>(null);
  const size = params.size ?? '1024x1024';
  const running = node.runState === 'running';
  const firstAsset = node.output?.assets?.[0];
  const assetUrl = useAssetUrl(firstAsset);

  useEffect(() => {
    setPrompt((params.prompt as string) ?? '');
  }, [params.prompt]);

  const commitPrompt = () => {
    if (prompt === params.prompt) return;
    void canvasStore.updateNodeParams(sessionId, node.id, { ...params, prompt });
  };

  const run = () => {
    if (running || !prompt.trim()) return;
    if (prompt !== params.prompt) {
      void canvasStore
        .updateNodeParams(sessionId, node.id, { ...params, prompt })
        .then(() => canvasStore.runNode(sessionId, node.id));
    } else {
      void canvasStore.runNode(sessionId, node.id);
    }
  };

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col rounded-xl border bg-paper-raised p-3 text-xs shadow-sm transition-shadow',
        selected ? 'border-accent' : 'border-line',
        running && 'canvas-node-running',
      )}
    >
      <NodeResizer
        minWidth={260}
        minHeight={200}
        isVisible={selected}
        lineClassName="!border-accent/40"
        handleClassName="!h-2 !w-2 !rounded-sm !border-accent !bg-paper"
        onResizeEnd={(_, p) => canvasStore.resizeNode(sessionId, id, p.width, p.height)}
      />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-line !bg-paper" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-line !bg-accent" />

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate font-medium text-ink-muted">{node.title || '图片'}</span>
        <div className="flex shrink-0 items-center gap-1">
          {node.dirty && !running ? (
            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              待更新
            </span>
          ) : null}
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
            {node.runState === 'idle' ? '未运行' : running ? '生成中' : node.runState === 'done' ? '完成' : '失败'}
          </span>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={commitPrompt}
        rows={2}
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
          onClick={() => void canvasStore.runGraph(sessionId, node.id)}
          disabled={running}
          className="nodrag ml-auto rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted hover:bg-paper-inset disabled:opacity-40"
          title="从这里往下重新运行"
        >
          从这里
        </button>
        <button
          type="button"
          onClick={run}
          disabled={running || !prompt.trim()}
          className="nodrag inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] text-paper-raised disabled:opacity-40"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          运行
        </button>
      </div>

      {node.output?.error ? (
        <p className="mt-2 rounded-lg bg-danger/10 px-2 py-1 text-[11px] text-danger">{node.output.error}</p>
      ) : null}

      {assetUrl ? (
        <div className="group relative mt-2 min-h-0 flex-1 overflow-hidden rounded-lg border border-line">
          <img
            src={assetUrl}
            alt=""
            onClick={() => setZoom(assetUrl)}
            className="nodrag h-full w-full cursor-zoom-in object-contain"
          />
          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <a
              href={assetUrl}
              download
              onClick={(e) => e.stopPropagation()}
              className="nodrag rounded-md bg-black/50 p-1 text-white hover:bg-black/70"
              title="下载"
            >
              <Download size={12} />
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void canvasStore.saveAsset(sessionId, node.id, 0);
              }}
              className="nodrag rounded-md bg-black/50 p-1 text-white hover:bg-black/70"
              title="存到作品"
            >
              <FolderPlus size={12} />
            </button>
          </div>
        </div>
      ) : null}

      {zoom ? <Lightbox src={zoom} onClose={() => setZoom(null)} /> : null}
    </div>
  );
}
