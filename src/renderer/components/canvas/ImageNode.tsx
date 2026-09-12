import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { Position, type NodeProps, useStore } from '@xyflow/react';
import { Loader2, Play, Sparkles, ImageIcon, X, FileUp, Bot, Upload } from 'lucide-react';
import type { CanvasImageParams, CanvasNode } from '../../../shared/canvas';
import { editNodeTitle, type ImageEditKind } from '../../../shared/canvasImageEdit';
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
import { useIsSoloSelected } from './useSelectionCount';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { useAssetUrl } from './useAssetUrl';
import ImageNodeEditToolbar from './imageEdit/ImageNodeEditToolbar';
import { EditKindIcon } from './imageEdit/editIcons';
import CropOverlay from './imageEdit/CropOverlay';
import AnnotateOverlay from './imageEdit/AnnotateOverlay';
import MaskOverlay from './imageEdit/MaskOverlay';
import MultiAnglePanel from './imageEdit/MultiAnglePanel';
import RelightPanel from './imageEdit/RelightPanel';
import OutpaintOverlay from './imageEdit/OutpaintOverlay';
import ParamPopover from './imageEdit/ParamPopover';
import EditParamsPanel from './imageEdit/EditParamsPanel';
import type { EditCommitMode } from './imageEdit/commitEdit';
import { OPEN_IMAGE_EDIT_EVENT, openImageEdit, type OpenImageEditDetail } from './imageEdit/openImageEdit';

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

function ImageEditOverlay({
  kind,
  sessionId,
  node,
  imageUrl,
  commitMode = 'derive',
  onClose,
}: {
  kind: ImageEditKind;
  sessionId: string;
  node: CanvasNode;
  imageUrl: string;
  commitMode?: EditCommitMode;
  onClose: () => void;
}) {
  if (kind === 'crop') {
    return (
      <CropOverlay
        sessionId={sessionId}
        node={node}
        imageUrl={imageUrl}
        commitMode={commitMode}
        onClose={onClose}
      />
    );
  }
  if (kind === 'annotate') {
    return (
      <AnnotateOverlay
        sessionId={sessionId}
        node={node}
        imageUrl={imageUrl}
        commitMode={commitMode}
        onClose={onClose}
      />
    );
  }
  if (kind === 'inpaint' || kind === 'erase') {
    return (
      <MaskOverlay
        sessionId={sessionId}
        node={node}
        imageUrl={imageUrl}
        mode={kind}
        commitMode={commitMode}
        onClose={onClose}
      />
    );
  }
  if (kind === 'multiAngle') return <MultiAnglePanel sessionId={sessionId} node={node} imageUrl={imageUrl} onClose={onClose} />;
  if (kind === 'relight') return <RelightPanel sessionId={sessionId} node={node} imageUrl={imageUrl} onClose={onClose} />;
  if (kind === 'outpaint') {
    return (
      <OutpaintOverlay
        sessionId={sessionId}
        node={node}
        imageUrl={imageUrl}
        commitMode={commitMode}
        onClose={onClose}
      />
    );
  }
  if (kind === 'resize' || kind === 'enhance' || kind === 'split') {
    return (
      <ParamPopover
        sessionId={sessionId}
        node={node}
        imageUrl={imageUrl}
        kind={kind}
        commitMode={commitMode}
        onClose={onClose}
      />
    );
  }
  return null;
}

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
  const edit = params.edit;
  const [prompt, setPrompt] = useState(params.prompt ?? '');
  const [showConfig, setShowConfig] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<ImageEditKind | null>(null);
  const [overlayCommitMode, setOverlayCommitMode] = useState<EditCommitMode>('derive');
  const [assetIdx, setAssetIdx] = useState(node.output?.activeAssetIndex ?? 0);
  const [variationsCount, setVariationsCount] = useState<1 | 2 | 4>(
    params.count === 4 ? 4 : params.count === 2 ? 2 : 1,
  );
  const { hovered, hoverProps } = useHoverIntent();
  const size = params.size ?? '1024x1024';
  const running = node.runState === 'running';
  const assets = node.output?.assets ?? [];
  const current = assets[Math.min(assetIdx, assets.length - 1)];
  const edges = useCanvasStore((s) => s.edgesBySession[sessionId] ?? canvasStore.EMPTY_EDGES);
  const allNodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const assetUrl = useAssetUrl(current);
  const hasImage = Boolean(assetUrl);
  const sourceNode = allNodes.find((n) => n.id === edit?.sourceNodeId);
  const sourceRel =
    sourceNode?.output?.assets?.[sourceNode.output.activeAssetIndex ?? 0] ?? sourceNode?.output?.assets?.[0];
  const sourceUrl = useAssetUrl(sourceRel);

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

  const solo = useIsSoloSelected(selected);
  const canvasZoom = useStore((s) => s.transform[2]) || 1;
  const headerScale = Math.min(8, Math.max(1, 1 / canvasZoom));
  const expanded = solo || hovered;
  const candidates = useMemo(() => {
    if (!expanded) return [];
    const snapshot = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
    return snapshot.filter((n) => n.id !== node.id && n.type !== 'anchor');
  }, [expanded, sessionId, node.id]);

  // Multi-select collapses per-node chrome; drop any manually-opened config too.
  useEffect(() => {
    if (!solo) setShowConfig(false);
  }, [solo]);

  const autoSeededRef = useRef(false);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenImageEditDetail>).detail;
      if (!detail || detail.sessionId !== sessionId || detail.nodeId !== node.id) return;
      if (detail.kind === 'matting') {
        void canvasStore.deriveImageEdit(sessionId, node.id, { kind: 'matting' });
        return;
      }
      setOverlayCommitMode(detail.commitMode ?? 'derive');
      setActiveOverlay(detail.kind);
    };
    window.addEventListener(OPEN_IMAGE_EDIT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_IMAGE_EDIT_EVENT, onOpen);
  }, [sessionId, node.id]);

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

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const ratio = nw / nh;
    let targetW = 240;
    let targetH = Math.round(targetW / ratio);
    if (targetH > 380) {
      targetH = 380;
      targetW = Math.round(targetH * ratio);
    } else if (targetH < 140) {
      targetH = 140;
      targetW = Math.round(targetH * ratio);
    }
    if (Math.abs(node.w - targetW) > 4 || Math.abs(node.h - targetH) > 4) {
      void canvasStore.resizeNode(sessionId, node.id, targetW, targetH);
    }
  };

  return (
    <div
      {...hoverProps}
      className={cn(
        'relative flex h-full w-full flex-col text-xs transition-all rounded-2xl p-0',
        selected
          ? 'border-2 border-[#edd7a3] shadow-[0_0_12px_rgba(237,215,163,0.35)]'
          : 'border border-white/15 hover:border-white/35',
        running && 'canvas-node-running',
        highlighted && 'canvas-node-highlight',
        isProposal && 'border-dashed !border-2 !border-accent shadow-[0_0_15px_rgba(99,102,241,0.35)] animate-pulse-subtle',
      )}
    >
      <AgentMark show={agentMark} />
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
      {/* TapNow magnetic handles with elastic follow and click-to-create */}
      <MagneticHandle
        type="target"
        position={Position.Left}
        id="prompt"
        nodeId={node.id}
        kind="prompt"
        label="添加上下文"
        top="50%"
        nodeHovered={hovered || selected}
      />
      {edit ? (
        <MagneticHandle
          type="target"
          position={Position.Left}
          id="edit_src"
          nodeId={node.id}
          kind="image"
          label="源图"
          top="28%"
          nodeHovered={hovered || selected}
        />
      ) : null}
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="image_out"
        nodeId={node.id}
        kind="image"
        label="引用该节点生成"
        top="50%"
        nodeHovered={hovered || selected}
      />

      {/* Floating Upload button above empty image node (Morphology 1) */}
      {!hasImage && !edit ? (
        <div
          className="nodrag cursor-default absolute bottom-[calc(100%+8px)] left-1/2 z-30 -translate-x-1/2"
          style={{ transform: `translateX(-50%) scale(${headerScale})`, transformOrigin: 'bottom center' }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="flex items-center gap-1.5 rounded-full bg-[#18181b]/95 px-3 py-1 text-xs font-medium text-white/90 shadow-md border border-white/10 hover:bg-[#27272a] hover:text-white active:scale-95 transition-all cursor-pointer whitespace-nowrap"
            title="上传本地图片"
          >
            <Upload size={12} className="stroke-[2.2]" />
            <span>上传</span>
          </button>
        </div>
      ) : null}

      {/* Floating anti-zoom header outside the card boundary (TapNow design) */}
      <FloatingNodeHeader
        sessionId={sessionId}
        nodeId={node.id}
        title={node.title}
        fallback={edit ? editNodeTitle(edit.kind) : '图片'}
        icon={
          edit ? (
            <EditKindIcon kind={edit.kind} size={13} />
          ) : (
            <ImageIcon size={13} className="text-indigo-400 shrink-0" />
          )
        }
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
        <div
          className={cn(
            'relative h-full w-full rounded-2xl overflow-hidden',
            edit?.kind === 'matting' || current?.endsWith('.png') ? 'canvas-checker' : 'bg-black/80',
          )}
        >
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

          <div className="group/image relative z-10 h-full w-full select-none">
            <img
              src={assetUrl!}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={handleImageLoad}
              onDoubleClick={() => setZoom(assetUrl)}
              className="h-full w-full object-cover pointer-events-auto"
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

            {/* Top Right Replace button (Matching pure reference design) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="nodrag absolute right-2.5 top-2.5 z-20 flex items-center gap-1.5 rounded-lg bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md border border-white/10 hover:bg-black/85 hover:text-white transition-all shadow-xs cursor-pointer"
              title="替换图片"
            >
              <Upload size={11} className="stroke-[2.2]" />
              <span>替换</span>
            </button>
          </div>
        </div>
      ) : null}

      {hasImage ? (
        <ImageNodeEditToolbar sessionId={sessionId} node={node} visible={hovered || solo} />
      ) : null}

      {edit && !hasImage ? (
        <div className="relative flex h-full w-full flex-col items-center justify-center rounded-2xl bg-[#18181b]/80 p-4 text-center select-none">
          {running ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <Loader2 size={24} className="animate-spin text-[#edd7a3]" />
              <span className="text-[11px] font-medium text-white/60">正在编辑…</span>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/[0.04] p-3 text-white/30">
              <Sparkles size={24} />
            </div>
          )}
        </div>
      ) : null}

      {/* Clean & Pure Empty Image Placeholder / Dropzone */}
      {!hasImage && !edit ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'group/placeholder relative flex h-full w-full flex-col items-center justify-center rounded-2xl transition-all select-none',
            isDragging ? 'bg-white/[0.08]' : 'bg-[#18181b]/80',
          )}
          title="支持拖入图片或点击上方上传"
        >
          {running ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <Loader2 size={26} className="animate-spin text-[#edd7a3]" />
              <span className="text-[11px] font-medium text-white/60">生成中…</span>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/[0.03] p-4 text-white/30 group-hover/placeholder:text-white/60 group-hover/placeholder:scale-105 transition-all pointer-events-none">
              <ImageIcon size={32} strokeWidth={1.4} />
            </div>
          )}
        </div>
      ) : null}

      {/* TapNow floating generation panel with inverse-scale compensation (Only visible on empty node, State 1) */}
      {edit ? (
        <EditParamsPanel
          sessionId={sessionId}
          node={node}
          visible={solo}
          running={running}
          onRedraw={(kind) => {
            openImageEdit({ sessionId, nodeId: node.id, kind, commitMode: 'revise' });
          }}
        />
      ) : (
      <NodeFloatingPanel
        sessionId={sessionId}
        node={node}
        visible={Boolean((solo || showConfig) && !hasImage)}
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
      )}

      {zoom ? <Lightbox src={zoom} onClose={() => setZoom(null)} /> : null}
      {activeOverlay && (overlayCommitMode === 'revise' ? sourceUrl || assetUrl : assetUrl) ? (
        <ImageEditOverlay
          kind={activeOverlay}
          sessionId={sessionId}
          node={node}
          imageUrl={(overlayCommitMode === 'revise' ? sourceUrl || assetUrl : assetUrl)!}
          commitMode={overlayCommitMode}
          onClose={() => setActiveOverlay(null)}
        />
      ) : null}
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
