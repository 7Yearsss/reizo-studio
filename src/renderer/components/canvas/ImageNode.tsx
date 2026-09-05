import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Download, FolderPlus, Loader2, Play, GitBranchPlus, Bot, Video, SlidersHorizontal, Sparkles, ImageIcon, RotateCw } from 'lucide-react';
import type { CanvasImageParams, CanvasNode } from '../../../shared/canvas';
import { CANVAS_IMAGE_MODELS } from '../../../shared/canvas';
import { estimateNodeCost } from '../../../shared/canvasPricing';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { cn } from '../../lib/cn';
import Lightbox from './Lightbox';
import MentionTextArea from './MentionTextArea';
import NodeActionBar, { useHoverIntent, type NodeAction } from './NodeActionBar';
import NodeHandle, { ProgressiveRefHandles } from './NodeHandle';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { useAssetUrl } from './useAssetUrl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export interface CanvasNodeData extends Record<string, unknown> {
  sessionId: string;
  node: CanvasNode;
  highlighted?: boolean;
  /** The agent wrote this node in the last ~8s. */
  agentMark?: boolean;
  /** The node is in Agent proposal review state. */
  isProposal?: boolean;
  readiness?: string[];
  hasUpstreamPrompt?: boolean;
  hasUpstreamStartFrame?: boolean;
  hasUpstreamAsset?: boolean;
  refCount?: number;
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

export default memo(function ImageNode({ id, data, selected }: NodeProps) {
  const {
    sessionId,
    node,
    highlighted,
    agentMark,
    isProposal,
    readiness = [],
    hasUpstreamPrompt = false,
    refCount = 0,
  } = data as CanvasNodeData;

  const params = node.params as CanvasImageParams;
  const [prompt, setPrompt] = useState(params.prompt ?? '');
  const [showConfig, setShowConfig] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [assetIdx, setAssetIdx] = useState(0);
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const { hovered, hoverProps } = useHoverIntent();
  const size = params.size ?? '1024x1024';
  const running = node.runState === 'running';
  const assets = node.output?.assets ?? [];
  const current = assets[Math.min(assetIdx, assets.length - 1)];
  const assetUrl = useAssetUrl(current);
  const hasImage = Boolean(assetUrl);

  const expanded = selected || hovered;
  const candidates = useMemo(() => {
    if (!expanded) return [];
    const snapshot = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
    return snapshot.filter((n) => n.id !== node.id && (n.output?.assets?.length ?? 0) > 0);
  }, [expanded, sessionId, node.id]);

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
    if (running) return;
    if (!prompt.trim() && !hasUpstreamPrompt) return;
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
        'relative flex h-full w-full flex-col rounded-xl border bg-paper-raised p-2.5 text-xs shadow-sm transition-shadow',
        selected ? 'border-accent ring-1 ring-accent/20' : 'border-line',
        running && 'canvas-node-running',
        highlighted && 'canvas-node-highlight',
        isProposal && 'border-dashed !border-2 !border-accent shadow-[0_0_15px_rgba(99,102,241,0.35)] animate-pulse-subtle',
      )}
    >
      <AgentMark show={agentMark} />
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
        minWidth={240}
        minHeight={180}
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
      <NodeHandle type="target" position={Position.Left} id="prompt" kind="prompt" label="提示词" expanded={expanded} top="18%" />
      <NodeHandle type="target" position={Position.Left} id="image_in" kind="image" label="图生图" expanded={expanded} top="38%" />
      <ProgressiveRefHandles connectedCount={refCount} expanded={expanded} topStart={0.55} gap={0.16} />
      <NodeHandle type="source" position={Position.Right} id="image_out" kind="image" label="图像输出" expanded={expanded} top="50%" />

      {/* Header */}
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <ImageIcon size={13} className="text-accent shrink-0" />
          <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="生图" />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!running && readiness.length > 0 ? <MissingInputWarning messages={readiness} /> : null}
          {node.dirty && !running ? (
            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-600 dark:text-amber-400">
              待更新
            </span>
          ) : null}
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px]',
              node.runState === 'error'
                ? 'bg-danger/10 text-danger'
                : node.runState === 'done'
                  ? 'bg-success/10 text-success'
                  : running
                    ? 'bg-accent/10 text-accent'
                    : 'bg-paper-inset text-ink-muted',
            )}
          >
            {node.runState === 'idle' ? '未运行' : running ? '生成中' : node.runState === 'done' ? '就绪' : '失败'}
          </span>
          {hasImage && (
            <button
              type="button"
              onClick={() => setShowConfig((v) => !v)}
              className={cn(
                'nodrag rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors',
                showConfig && 'bg-accent/15 text-accent',
              )}
              title={showConfig ? '收起配置 (纯画面模式)' : '展开提示词与参数配置'}
            >
              <SlidersHorizontal size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {node.output?.error ? (
        <div className="mb-2 flex flex-col gap-1 rounded-lg bg-danger/10 p-2 text-[11px] text-danger">
          <p className="line-clamp-2">{node.output.error}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void chatStore.sendMessage(
                sessionId,
                `画布上的图片节点「${node.title || node.id}」运行报错：\n“${node.output?.error}”\n当前 Prompt 为：“${prompt}”。\n请分析报错原因并帮我生成优化修正后的可用 Prompt。`,
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

      {/* Hero Image view (when media exists and config is closed) */}
      {hasImage && !showConfig ? (
        <div className="group/image relative min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-black/40">
          <img
            src={assetUrl!}
            alt=""
            loading="lazy"
            decoding="async"
            onClick={() => setZoom(assetUrl)}
            className="nodrag h-full w-full cursor-zoom-in object-contain"
          />

          {/* Version Switcher if multiple assets */}
          {assets.length > 1 ? (
            <div className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-1 bg-black/50 py-0.5 backdrop-blur-[2px]">
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
                  title={`版本 v${assets.length - i}`}
                >
                  v{assets.length - i}
                </button>
              ))}
            </div>
          ) : null}

          {/* Hover Bottom Bar with Prompt Peek & Quick Rerun */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 transition-opacity group-hover/image:opacity-100">
            <span
              className="truncate max-w-[70%] rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/90 select-none backdrop-blur-xs"
              title={prompt || (hasUpstreamPrompt ? '上游节点提示词驱动' : '')}
            >
              {prompt ? `“${prompt}”` : hasUpstreamPrompt ? '✦ 上游提示词驱动' : '无提示词'}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                run();
              }}
              disabled={running}
              className="pointer-events-auto nodrag flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[9px] font-medium text-accent-ink shadow-md hover:opacity-90 active:scale-95"
              title="重新生成"
            >
              {running ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={9} />}
              重跑
            </button>
          </div>

          {/* Hover Top Right Action Buttons */}
          <div className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/image:opacity-100">
            <a
              href={assetUrl!}
              download
              onClick={(e) => e.stopPropagation()}
              className="nodrag rounded-md bg-black/60 p-1 text-white hover:bg-black/80 transition-colors"
              title="下载图片"
            >
              <Download size={11} />
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void canvasStore.saveAsset(sessionId, node.id, assetIdx);
              }}
              className="nodrag rounded-md bg-black/60 p-1 text-white hover:bg-black/80 transition-colors"
              title="存入作品库"
            >
              <FolderPlus size={11} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Upstream Connected Ready State (when no image yet and upstream prompt exists) */}
      {!hasImage && hasUpstreamPrompt && !showConfig ? (
        <div className="mt-1 flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-accent/40 bg-accent/5 p-4 text-center">
          <Sparkles size={20} className="text-accent mb-1.5 animate-pulse-subtle" />
          <span className="text-xs font-semibold text-ink">已接入上游提示词</span>
          <p className="mt-1 text-[10px] text-ink-muted leading-relaxed">
            由上游便签或 Agent 节点提供画面描述
          </p>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="nodrag mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-ink shadow-md hover:opacity-95 active:scale-98 transition-all disabled:opacity-40"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} className="fill-current" />}
            生成画面
            <span className="text-[9px] opacity-75 font-normal ml-0.5">(~{estimateNodeCost(node)}点)</span>
          </button>
        </div>
      ) : null}

      {/* Config / Prompt Input Area (when standalone, or explicitly opened) */}
      {(!hasImage && !hasUpstreamPrompt) || showConfig ? (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="mt-1">
            <MentionTextArea
              value={prompt}
              onChange={setPrompt}
              onCommit={commitPrompt}
              candidates={candidates}
              placeholder="描述画面视觉风格、主体与光影细节（或拉出左侧提示词端口连接便签）…"
              onMentionSelect={(refNode) => {
                void canvasStore.connectNodes(sessionId, refNode.id, node.id, 'reference');
              }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-1.5 flex-wrap">
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
                  className="nodrag h-7 max-w-[130px] rounded-lg border-line/70 bg-paper-inset/40 px-2 py-1 text-[10px] font-medium text-ink hover:border-accent hover:bg-paper-inset/70 transition-colors"
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

              {/* Segmented Pill Group for Size */}
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
                className="nodrag rounded-lg border border-line/70 px-2 py-1 text-[10px] text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors disabled:opacity-40"
                title="从这里往下重新运行整条流水线"
              >
                向下跑
              </button>
              <button
                type="button"
                onClick={run}
                disabled={running || (!prompt.trim() && !hasUpstreamPrompt)}
                title={`生成图片 (单次预计消耗约 ${estimateNodeCost(node)} 算力点)`}
                className="nodrag inline-flex items-center gap-1 rounded-lg bg-accent text-accent-ink px-3 py-1 text-[10px] font-medium shadow-xs hover:opacity-90 active:scale-95 transition-all disabled:opacity-40"
              >
                {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={10} className="fill-current" />}
                生成
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {zoom ? <Lightbox src={zoom} onClose={() => setZoom(null)} /> : null}
    </div>
  );
}, (prev, next) => {
  const prevData = prev.data as CanvasNodeData;
  const nextData = next.data as CanvasNodeData;
  return (
    prev.selected === next.selected &&
    prev.width === next.width &&
    prev.height === next.height &&
    prevData.sessionId === nextData.sessionId &&
    prevData.highlighted === nextData.highlighted &&
    prevData.agentMark === nextData.agentMark &&
    prevData.isProposal === nextData.isProposal &&
    prevData.hasUpstreamPrompt === nextData.hasUpstreamPrompt &&
    prevData.refCount === nextData.refCount &&
    prevData.readiness === nextData.readiness &&
    prevData.node === nextData.node
  );
});
