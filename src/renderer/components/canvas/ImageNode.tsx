import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Download, FolderPlus, Loader2, Play, Sparkles, ImageIcon, RotateCw, X, FileUp, Maximize2, Bot } from 'lucide-react';
import type { CanvasImageParams, CanvasNode } from '../../../shared/canvas';
import { estimateNodeCost } from '../../../shared/canvasPricing';
import { serializeMention } from '../../../shared/resolveMentions';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import Lightbox from './Lightbox';
import { useHoverIntent } from './NodeActionBar';
import MagneticHandle from './MagneticHandle';
import NodeFloatingPanel from './NodeFloatingPanel';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { useAssetUrl } from './useAssetUrl';

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

import FloatingNodeHeader, { NodeTitle } from './FloatingNodeHeader';
export { NodeTitle, FloatingNodeHeader };

function VariantThumbnail({
  asset,
  index,
  total,
  isSelected,
  onSelect,
  onRemove,
}: {
  asset: string;
  index: number;
  total: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const url = useAssetUrl(asset);
  return (
    <div className="group/thumb relative flex items-center shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        className={cn(
          'nodrag relative flex items-center justify-center rounded overflow-hidden border transition-all',
          isSelected
            ? 'border-accent ring-2 ring-accent/70 scale-105 shadow-md z-10'
            : 'border-white/30 opacity-75 hover:opacity-100 hover:border-white/70',
        )}
        style={{ width: 28, height: 28 }}
        title={`变体 ${index + 1} / ${total} (点击切换)`}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-black/60 text-[9px] text-white font-medium">
            {index + 1}
          </div>
        )}
        <span className="absolute bottom-0 right-0 rounded-tl bg-black/85 px-1 text-[8px] font-bold text-white leading-tight">
          {index + 1}
        </span>
      </button>
      {total > 1 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="nodrag absolute -top-1 -right-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-danger text-white shadow-xs group-hover/thumb:flex hover:scale-110 transition-transform z-20"
          title="删除该变体"
        >
          <X size={8} />
        </button>
      ) : null}
    </div>
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
  const [assetIdx, setAssetIdx] = useState(node.output?.activeAssetIndex ?? 0);
  const [variationsCount, setVariationsCount] = useState<1 | 2 | 4>(
    params.count === 4 ? 4 : params.count === 2 ? 2 : 1,
  );
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const { hovered, hoverProps } = useHoverIntent();
  const size = params.size ?? '1024x1024';
  const running = node.runState === 'running';
  const assets = node.output?.assets ?? [];
  const current = assets[Math.min(assetIdx, assets.length - 1)];
  const assetUrl = useAssetUrl(current);
  const hasImage = Boolean(assetUrl);

  const edges = useCanvasStore((s) => s.edgesBySession[sessionId] ?? canvasStore.EMPTY_EDGES);
  const allNodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);

  const upstreamSources = useMemo(() => {
    const inEdges = edges.filter((e) => e.targetId === node.id);
    return inEdges.map((e) => {
      const srcNode = allNodes.find((n) => n.id === e.sourceId);
      return {
        edgeId: e.id,
        sourceNodeId: e.sourceId,
        sourceType: srcNode?.type || 'node',
        sourceTitle: srcNode?.title || (srcNode?.type === 'note' ? '提示词' : srcNode?.type === 'image' ? '图片' : '节点'),
        handleId: e.targetHandle,
      };
    });
  }, [edges, allNodes, node.id]);

  const expanded = selected || hovered;
  const candidates = useMemo(() => {
    if (!expanded) return [];
    const snapshot = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
    return snapshot.filter((n) => n.id !== node.id && n.type !== 'anchor');
  }, [expanded, sessionId, node.id]);

  const autoSeededRef = useRef(false);
  useEffect(() => {
    if (!autoSeededRef.current && !params.prompt && upstreamSources.length > 0) {
      const firstNote = upstreamSources.find((s) => s.sourceType === 'note');
      if (firstNote) {
        autoSeededRef.current = true;
        const initial = `${serializeMention(firstNote.sourceTitle, firstNote.sourceNodeId)} `;
        setPrompt(initial);
        void canvasStore.updateNodeParams(sessionId, node.id, { ...params, prompt: initial });
      }
    }
  }, [upstreamSources, params.prompt, sessionId, node.id, params]);

  useEffect(() => {
    setPrompt((params.prompt as string) ?? '');
  }, [params.prompt]);
  useEffect(() => {
    if (typeof node.output?.activeAssetIndex === 'number') {
      setAssetIdx(node.output.activeAssetIndex);
    }
  }, [node.output?.activeAssetIndex]);
  useEffect(() => {
    if (assets.length > 0 && assetIdx >= assets.length) setAssetIdx(0);
  }, [assets.length, assetIdx]);

  const commitPrompt = () => {
    if (prompt === params.prompt) return;
    void canvasStore.updateNodeParams(sessionId, node.id, { ...params, prompt });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    try {
      await canvasStore.uploadAssetToNode(sessionId, node.id, file);
    } catch {
      /* ignore */
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleUpload(file);
  };

  const run = () => {
    if (running) return;
    if (!prompt.trim() && !hasUpstreamPrompt) return;
    const updatedParams = { ...params, prompt, count: variationsCount };
    void canvasStore
      .updateNodeParams(sessionId, node.id, updatedParams)
      .then(() => canvasStore.runNode(sessionId, node.id));
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
      {/* TapNow magnetic handles with elastic follow and click-to-create */}
      <MagneticHandle
        type="target"
        position={Position.Left}
        id="prompt"
        nodeId={node.id}
        kind="prompt"
        label="添加上下文"
        top="50%"
      />
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="image_out"
        nodeId={node.id}
        kind="image"
        label="引用该节点生成"
        top="50%"
      />

      {/* Floating anti-zoom header outside the card boundary (TapNow design) */}
      <FloatingNodeHeader
        sessionId={sessionId}
        nodeId={node.id}
        title={node.title}
        fallback="生图"
        icon={<ImageIcon size={13} className="text-indigo-400 shrink-0" />}
        selected={selected}
        hovered={hovered}
        running={running}
        badge={
          assets.length > 1 ? (
            <span
              className="rounded-full bg-indigo-500/15 border border-indigo-500/25 px-1.5 py-0.5 text-[9px] font-medium text-indigo-400 select-none"
              title={`共 ${assets.length} 个生成变体结果，当前展示第 ${assetIdx + 1} 项`}
            >
              变体 {assetIdx + 1}/{assets.length}
            </span>
          ) : null
        }
        status={
          <>
            {!running && readiness.some((m) => m.includes('已删除') || m.includes('尚未生成')) ? (
              <MissingInputWarning messages={readiness} />
            ) : null}
            {node.dirty && !running ? (
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-600 dark:text-amber-400">
                待更新
              </span>
            ) : null}
            {node.runState !== 'idle' ? (
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
                {running ? '生成中' : node.runState === 'done' ? '就绪' : '失败'}
              </span>
            ) : null}
          </>
        }
      />

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

      {/* Hero Image view (when media exists) */}
      {hasImage ? (
        <div className="relative min-h-0 flex-1 flex flex-col">
          {/* Stacked card deck layers when multiple variants exist (TapNow 4x result set visual) */}
          {assets.length > 1 ? (
            <>
              {assets.length > 2 ? (
                <div
                  className="pointer-events-none absolute inset-0 -top-1.5 -right-1.5 rounded-lg border border-line/40 bg-black/25 shadow-xs"
                  style={{ zIndex: 0 }}
                />
              ) : null}
              <div
                className="pointer-events-none absolute inset-0 -top-1 -right-1 rounded-lg border border-line/60 bg-black/35 shadow-xs"
                style={{ zIndex: 1 }}
              />
            </>
          ) : null}

          <div className="group/image relative z-10 min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-black/40 select-none">
            <img
              src={assetUrl!}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onDoubleClick={() => setZoom(assetUrl)}
              className="h-full w-full object-contain pointer-events-auto"
              title="双击全屏放大，拖拽移动节点"
            />

            {/* Version / Multi-result set Thumbnail Switcher */}
            {assets.length > 1 ? (
              <div className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-1.5 bg-black/60 px-2 py-1 backdrop-blur-[3px] z-20 overflow-x-auto no-scrollbar">
                {assets.map((asset, i) => (
                  <VariantThumbnail
                    key={asset || i}
                    asset={asset}
                    index={i}
                    total={assets.length}
                    isSelected={i === assetIdx}
                    onSelect={() => {
                      setAssetIdx(i);
                      void canvasStore.updateNodeOutput(sessionId, node.id, {
                        ...node.output,
                        activeAssetIndex: i,
                      });
                    }}
                    onRemove={() => {
                      void canvasStore.removeNodeAsset(sessionId, node.id, i);
                    }}
                  />
                ))}
              </div>
            ) : null}

            {/* Hover Bottom Bar with Prompt Peek & Quick Rerun (only when no bottom thumbnails or positioned slightly higher) */}
            <div
              className={cn(
                'pointer-events-none absolute inset-x-0 flex items-center justify-between p-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 transition-opacity group-hover/image:opacity-100 z-10',
                assets.length > 1 ? 'bottom-10' : 'bottom-0',
              )}
            >
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
            <div className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/image:opacity-100 z-20">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoom(assetUrl);
                }}
                className="nodrag rounded-md bg-black/60 p-1 text-white hover:bg-black/80 transition-colors"
                title="全屏放大查看 (双击图片也可放大)"
              >
                <Maximize2 size={11} />
              </button>
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
        </div>
      ) : null}

      {/* Upstream Connected Ready State (when no image yet and upstream prompt exists) */}
      {!hasImage && hasUpstreamPrompt ? (
        <div className="mt-1 flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-accent/40 bg-accent/5 p-4 text-center select-none">
          <Sparkles size={20} className="text-accent mb-1.5 animate-pulse-subtle pointer-events-none" />
          <span className="text-xs font-semibold text-ink pointer-events-none">已接入上游提示词</span>
          <p className="mt-1 text-[10px] text-ink-muted leading-relaxed pointer-events-none">
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

      {/* Clean Cover Placeholder / Dropzone (when standalone and no image yet) */}
      {!hasImage && !hasUpstreamPrompt ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'group/placeholder relative flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center transition-all select-none',
            isDragging
              ? 'border-accent bg-accent/10 scale-[0.99]'
              : 'border-line hover:border-accent/60 bg-black/20 hover:bg-black/30',
          )}
          title="点击卡片配置参数，支持拖入图片"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = '';
            }}
          />
          <div className="rounded-full bg-paper-inset/70 p-3 mb-2 text-ink-muted group-hover/placeholder:text-accent group-hover/placeholder:bg-accent/15 group-hover/placeholder:scale-110 transition-all shadow-xs pointer-events-none">
            <ImageIcon size={22} />
          </div>
          <span className="text-xs font-medium text-ink-muted group-hover/placeholder:text-ink pointer-events-none transition-colors">待生成图片卡片</span>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="nodrag rounded-md bg-paper-raised border border-line px-2 py-0.5 text-[9px] text-ink-muted hover:text-ink hover:border-accent transition-colors flex items-center gap-1"
              title="上传本地图片作为当前节点画面"
            >
              <FileUp size={10} />
              上传图片
            </button>
          </div>
        </div>
      ) : null}

      {/* TapNow floating generation panel with inverse-scale compensation */}
      <NodeFloatingPanel
        sessionId={sessionId}
        node={node}
        visible={Boolean(selected || showConfig)}
        prompt={prompt}
        onPromptChange={setPrompt}
        onPromptCommit={commitPrompt}
        candidates={candidates}
        upstreamSources={upstreamSources}
        running={running}
        onRun={run}
        size={size}
        onSizeChange={(s) => {
          void canvasStore.updateNodeParams(sessionId, node.id, { ...params, size: s });
        }}
        model={params.model || 'flux-schnell'}
        onModelChange={(m) => {
          void canvasStore.updateNodeParams(sessionId, node.id, { ...params, model: m });
        }}
        variationsCount={variationsCount}
        onVariationsCountChange={setVariationsCount}
        estimatedCost={estimateNodeCost(node)}
      />

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
