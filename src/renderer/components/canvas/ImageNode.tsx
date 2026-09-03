import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Download, FolderPlus, Loader2, Play, GitBranchPlus, Bot, Video } from 'lucide-react';
import type { CanvasImageParams, CanvasNode } from '../../../shared/canvas';
import { CANVAS_IMAGE_MODELS } from '../../../shared/canvas';
import { canvasAssetUrl } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import Lightbox from './Lightbox';
import MentionTextArea from './MentionTextArea';
import NodeActionBar, { useHoverIntent, type NodeAction } from './NodeActionBar';
import MissingInputWarning from './MissingInputWarning';
import { nodeReadinessIssues } from '../../../shared/canvasReadiness';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export interface CanvasNodeData extends Record<string, unknown> {
  sessionId: string;
  node: CanvasNode;
  highlighted?: boolean;
}

function useAssetUrl(rel: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!rel) {
      setUrl(null);
      return;
    }
    let ok = true;
    void canvasAssetUrl(rel).then((u) => ok && setUrl(u));
    return () => {
      ok = false;
    };
  }, [rel]);
  return url;
}

export function NodeTitle({
  sessionId,
  nodeId,
  title,
  fallback,
}: {
  sessionId: string;
  nodeId: string;
  title: string;
  fallback: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          void canvasStore.renameNode(sessionId, nodeId, draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(title);
            setEditing(false);
          }
        }}
        className="nodrag min-w-0 flex-1 rounded bg-paper-inset px-1 text-xs font-medium text-ink outline-none"
      />
    );
  }
  return (
    <span
      className="truncate font-medium text-ink-muted"
      title="双击重命名"
      onDoubleClick={() => {
        setDraft(title);
        setEditing(true);
      }}
    >
      {title || fallback}
    </span>
  );
}

export default function ImageNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, highlighted } = data as CanvasNodeData;
  const params = node.params as CanvasImageParams;
  const [prompt, setPrompt] = useState(params.prompt ?? '');
  const [zoom, setZoom] = useState<string | null>(null);
  const [assetIdx, setAssetIdx] = useState(0);
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const { hovered, hoverProps } = useHoverIntent();
  const size = params.size ?? '1024x1024';
  const running = node.runState === 'running';
  const assets = node.output?.assets ?? [];
  const current = assets[Math.min(assetIdx, assets.length - 1)];
  const assetUrl = useAssetUrl(current);

  const allNodes = useCanvasStore((s) => s.nodesBySession[sessionId]) ?? [];
  const allEdges = useCanvasStore((s) => s.edgesBySession[sessionId]) ?? [];
  const candidates = useMemo(
    () => allNodes.filter((n) => n.id !== node.id && (n.output?.assets?.length ?? 0) > 0),
    [allNodes, node.id],
  );
  const readiness = useMemo(
    () => nodeReadinessIssues(node, allEdges, new Map(allNodes.map((n) => [n.id, n]))),
    [node, allEdges, allNodes],
  );

  useEffect(() => {
    setPrompt((params.prompt as string) ?? '');
  }, [params.prompt]);
  useEffect(() => {
    if (assetIdx >= assets.length) setAssetIdx(0);
  }, [assets.length, assetIdx]);

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
      {...hoverProps}
      className={cn(
        'relative flex h-full w-full flex-col rounded-xl border bg-paper-raised p-3 text-xs shadow-sm transition-shadow',
        selected ? 'border-accent ring-1 ring-accent/20' : 'border-line',
        running && 'canvas-node-running',
        highlighted && 'canvas-node-highlight',
      )}
    >
      <NodeActionBar
        visible={selected || hovered}
        actions={[
          {
            id: 'variations',
            icon: <GitBranchPlus size={11} className="text-accent" />,
            label: '变体 ×4',
            title: '在右侧并排派生 4 个继承参数与上游连线的变体',
            onClick: () => void canvasStore.forkVariations(sessionId, node.id),
          },
          {
            id: 'animate',
            icon: <Video size={11} className="text-accent" />,
            label: '转视频',
            title: '在右侧生成以此图为首帧的运镜视频节点',
            onClick: () => void canvasStore.animateFromImage(sessionId, node.id),
          },
          {
            id: 'qa',
            icon: <Bot size={11} className="text-accent" />,
            label: '质检 Agent',
            title: '在右侧添加连接的画面质检 Agent 节点',
            onClick: () => void canvasStore.addDownstreamAgent(sessionId, node.id),
          },
          ...((assets.length > 0
            ? [
                {
                  id: 'save',
                  icon: <FolderPlus size={11} className="text-accent" />,
                  label: '存为产物',
                  title: '将当前选中的画面存入作品库',
                  onClick: () => void canvasStore.saveAsset(sessionId, node.id, assetIdx),
                },
              ]
            : []) as NodeAction[]),
        ]}
      />
      <NodeResizer
        minWidth={260}
        minHeight={200}
        isVisible={selected}
        lineClassName="!border-accent/40"
        handleClassName="!h-2 !w-2 !rounded-sm !border-accent !bg-paper"
        onResizeStart={(_, p: ResizeParams) => {
          resizeStart.current = { w: p.width, h: p.height };
        }}
        onResizeEnd={(_, p: ResizeParams) => {
          const from = resizeStart.current;
          resizeStart.current = null;
          if (from) canvasStore.commitResize(sessionId, id, from, { w: p.width, h: p.height });
        }}
      />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-line !bg-paper" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-line !bg-accent" />

      <div className="mb-2 flex items-center justify-between gap-2">
        <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="图片" />
        <div className="flex shrink-0 items-center gap-1">
          {!running && readiness.length > 0 ? <MissingInputWarning messages={readiness} /> : null}
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

      <div className="mt-1">
        <MentionTextArea
          value={prompt}
          onChange={setPrompt}
          onCommit={commitPrompt}
          candidates={candidates}
          placeholder="描述画面视觉风格、主体与光影细节（输入 @ 可引用画布节点）…"
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-1.5 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Select
            value={params.model || 'flux-schnell'}
            onValueChange={(val) =>
              void canvasStore.updateNodeParams(sessionId, node.id, {
                ...params,
                model: val,
              })
            }
          >
            <SelectTrigger
              size="sm"
              className="nodrag h-7 max-w-[140px] rounded-lg border-line/70 bg-paper-inset/40 px-2 py-1 text-[11px] font-medium text-ink hover:border-accent hover:bg-paper-inset/70 transition-colors"
            >
              <div className="flex items-center gap-1 truncate">
                <span className="text-accent text-[10px]">⚡</span>
                <SelectValue placeholder="模型选择" />
              </div>
            </SelectTrigger>
            <SelectContent className="min-w-[160px] rounded-xl border border-line bg-paper-raised/95 shadow-xl backdrop-blur-xl p-1 text-xs">
              {CANVAS_IMAGE_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs py-1.5 cursor-pointer rounded-lg hover:bg-paper-inset">
                  <div className="flex items-center justify-between w-full gap-2">
                    <span>{m.name}</span>
                    {'badge' in m ? (
                      <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] text-accent font-semibold">
                        {m.badge}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Segmented Pill Group for Size (1:1, 16:9, 9:16) */}
          <div className="flex items-center rounded-lg border border-line/60 bg-paper-inset/50 p-0.5">
            {[
              { id: '1024x1024', label: '1:1' },
              { id: '1536x1024', label: '16:9' },
              { id: '1024x1536', label: '9:16' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() =>
                  void canvasStore.updateNodeParams(sessionId, node.id, {
                    ...params,
                    size: opt.id as CanvasImageParams['size'],
                  })
                }
                className={cn(
                  'nodrag rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all',
                  size === opt.id
                    ? 'bg-paper-raised text-ink border border-line/60 shadow-xs font-semibold dark:bg-white/15 dark:text-white dark:border-white/20'
                    : 'text-ink-muted hover:text-ink',
                )}
                title={`画幅比例: ${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={() => void canvasStore.runGraph(sessionId, node.id)}
            disabled={running}
            className="nodrag rounded-lg border border-line/70 px-2 py-1 text-[11px] text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors disabled:opacity-40"
            title="从这里往下重新运行整条流水线"
          >
            向下跑
          </button>
          <button
            type="button"
            onClick={run}
            disabled={running || !prompt.trim()}
            className="nodrag inline-flex items-center gap-1 rounded-lg bg-accent text-accent-ink px-3 py-1 text-[11px] font-medium shadow-xs hover:opacity-90 active:scale-95 transition-all disabled:opacity-40"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} className="fill-current" />}
            生成
          </button>
        </div>
      </div>

      {node.output?.error ? (
        <div className="mt-2 flex flex-col gap-1 rounded-lg bg-danger/10 p-2 text-[11px] text-danger">
          <p className="line-clamp-2">{node.output.error}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void chatStore.sendMessage(
                sessionId,
                `画布上的图片节点「${node.title || node.id}」运行报错：\n“${node.output?.error}”\n当前 Prompt 为：“${prompt}”。\n请分析报错原因（如违禁词/格式/网络原因），并帮我生成优化修正后的可用 Prompt。`,
                [],
                {},
              );
            }}
            className="nodrag inline-flex items-center gap-1 self-start rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/30 transition-colors"
          >
            <Bot size={11} />
            让 Agent 协助修复提示词
          </button>
        </div>
      ) : null}

      {assetUrl ? (
        <div className="group relative mt-2 min-h-0 flex-1 overflow-hidden rounded-lg border border-line">
          <img
            src={assetUrl}
            alt=""
            onClick={() => setZoom(assetUrl)}
            className="nodrag h-full w-full cursor-zoom-in object-contain"
          />
          {assets.length > 1 ? (
            <div className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-1 bg-black/40 py-0.5 backdrop-blur-[2px]">
              {assets.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAssetIdx(i);
                  }}
                  className={cn(
                    'nodrag rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors',
                    i === assetIdx ? 'bg-accent text-accent-ink font-semibold shadow-sm' : 'bg-black/60 text-white/80 hover:bg-black/80',
                  )}
                  title={`版本 v${assets.length - i} (点击切换当前视图)`}
                >
                  v{assets.length - i}
                </button>
              ))}
            </div>
          ) : null}
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
                void canvasStore.saveAsset(sessionId, node.id, assetIdx);
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
