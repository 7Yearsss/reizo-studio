import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { NodeResizer, Position, type NodeProps, type ResizeParams, useStore } from '@xyflow/react';
import { Download, FolderPlus, Loader2, Play, Video, Camera, Sparkles, RotateCw, X, Bot } from 'lucide-react';
import type { CanvasVideoParams } from '../../../shared/canvas';
import { getVideoModelCapabilities } from '../../../shared/canvas';
import { estimateNodeCost } from '../../../shared/canvasPricing';
import { serializeMention } from '../../../shared/resolveMentions';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as chatStore from '../../state/chatStore';
import { cn } from '../../lib/cn';
import FloatingNodeHeader from './FloatingNodeHeader';
import { type CanvasNodeData } from './ImageNode';
import { useHoverIntent } from './NodeActionBar';
import MagneticHandle from './MagneticHandle';
import NodeFloatingPanel, { type UpstreamSourceItem } from './NodeFloatingPanel';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { useAssetUrl } from './useAssetUrl';

function VideoNode({ id, data, selected }: NodeProps) {
  const {
    sessionId,
    node,
    highlighted,
    agentMark,
    isProposal,
    readiness = [],
    hasUpstreamPrompt = false,
    hasUpstreamStartFrame = false,
  } = data as CanvasNodeData;
  const isLowLOD = useStore((s) => s.transform[2] < 0.35);
  const hideControls = isLowLOD;

  const params = (node.params as CanvasVideoParams) || { prompt: '' };
  const caps = getVideoModelCapabilities(params.model);
  const [prompt, setPrompt] = useState(params.prompt ?? '');
  const [showConfig, setShowConfig] = useState(false);
  const [assetIdx, setAssetIdx] = useState(node.output?.activeAssetIndex ?? 0);
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const running = node.runState === 'running';
  const assets = node.output?.assets ?? [];
  const current = assets[Math.min(assetIdx, assets.length - 1)];
  const assetUrl = useAssetUrl(current);
  const hasVideo = Boolean(assetUrl);
  const progress = node.output?.progress ?? 0;

  const videoElRef = useRef<HTMLVideoElement>(null);
  const [framePick, setFramePick] = useState<'start' | 'end' | 'current' | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const { hovered, hoverProps } = useHoverIntent();
  const expanded = selected || hovered;
  const showVideo = (expanded || isPlaying) && !isLowLOD;

  const candidates = useMemo(() => {
    if (!expanded) return [];
    const snapshot = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
    return snapshot.filter((n) => n.id !== node.id && n.type !== 'anchor');
  }, [expanded, sessionId, node.id]);

  const edges = useCanvasStore((s) => s.edgesBySession[sessionId] ?? canvasStore.EMPTY_EDGES);
  const allNodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);

  const upstreamSources = useMemo<UpstreamSourceItem[]>(() => {
    const inEdges = edges.filter((e) => e.targetId === node.id);
    return inEdges.map((e) => {
      const srcNode = allNodes.find((n) => n.id === e.sourceId);
      return {
        edgeId: e.id,
        sourceNodeId: e.sourceId,
        sourceType: srcNode?.type || 'node',
        sourceTitle:
          srcNode?.title ||
          (srcNode?.type === 'note'
            ? '提示词'
            : srcNode?.type === 'image'
              ? '首帧/参考图'
              : '节点'),
        handleId: e.targetHandle,
      };
    });
  }, [edges, allNodes, node.id]);

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

  const extractFrame = (pick: 'start' | 'end' | 'current') => {
    if (framePick || assets.length === 0) return;
    setFrameError(null);
    setFramePick(pick);
    const at = pick === 'current' ? (videoElRef.current?.currentTime ?? 0) : 0;
    void canvasStore
      .extractVideoFrame(sessionId, node.id, pick, at, assetIdx)
      .catch((err: unknown) => {
        setFrameError(err instanceof Error ? err.message : '抽帧失败');
        setTimeout(() => setFrameError(null), 3200);
      })
      .finally(() => setFramePick(null));
  };

  const run = () => {
    if (running) return;
    if (!prompt.trim() && !hasUpstreamPrompt && !hasUpstreamStartFrame) return;
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

      <NodeResizer
        minWidth={280}
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
        id="prompt_out"
        nodeId={node.id}
        kind="prompt"
        label="引用该节点生成"
        top="50%"
      />

      {/* Floating anti-zoom header outside the card boundary (TapNow design) */}
      <FloatingNodeHeader
        sessionId={sessionId}
        nodeId={node.id}
        title={node.title}
        fallback="视频"
        icon={<Video size={13} className="text-rose-400 shrink-0" />}
        selected={selected}
        hovered={hovered}
        running={running}
        badge={
          assets.length > 1 ? (
            <span className="rounded-full bg-rose-500/15 border border-rose-500/25 px-1.5 py-0.5 text-[9px] font-medium text-rose-400 select-none">
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
                        ? 'bg-accent/10 text-accent font-medium'
                        : 'bg-paper-inset text-ink-muted',
                )}
              >
                {running
                  ? `生成中 ${progress > 0 ? `${progress}%` : '...'}`
                  : node.runState === 'done'
                    ? '完成'
                    : '失败'}
              </span>
            ) : null}
          </>
        }
      />

      {/* Running Progress Bar (always visible when running) */}
      {running ? (
        <div className="mb-2 w-full overflow-hidden rounded-full bg-paper-inset">
          <div
            className="h-1.5 rounded-full bg-accent transition-all duration-300"
            style={{ width: `${Math.max(5, progress)}%` }}
          />
        </div>
      ) : null}

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
                `画布上的视频节点「${node.title || node.id}」运行报错：\n“${node.output?.error}”\n当前 Prompt 为：“${prompt}”。\n请分析报错原因（如违禁词/运镜参数冲突/模型超时），并帮我生成修改后的视频 Prompt 与参数建议。`,
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

      {/* Hero Video view (when media exists) */}
      {hasVideo ? (
        <div className="relative min-h-0 flex-1 flex flex-col">
          {/* Stacked card deck layers when multiple video results exist */}
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

          <div className="group/video relative z-10 min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-black/40 flex items-center justify-center">
            {showVideo ? (
              <video
                ref={videoElRef}
                src={assetUrl!}
                controls
                playsInline
                loop
                autoPlay={isPlaying}
                preload="metadata"
                className="nodrag h-full w-full object-contain"
              />
            ) : (
              <div
                className="group/poster relative h-full w-full flex items-center justify-center cursor-pointer bg-black/30 overflow-hidden select-none"
                onDoubleClick={() => setIsPlaying(true)}
                title="双击播放视频，或拖拽移动节点"
              >
                {expanded ? (
                  <video
                    src={`${assetUrl}#t=0.001`}
                    preload="metadata"
                    muted
                    playsInline
                    className="pointer-events-none h-full w-full object-contain opacity-90"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1.5 text-ink-muted select-none pointer-events-none">
                    <Video size={26} className="text-accent/60" />
                    <span className="text-[10px] text-ink-muted/80">点击播放 / 悬浮预览</span>
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/15 group-hover/poster:bg-black/30 transition-colors pointer-events-none">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsPlaying(true);
                    }}
                    className="nodrag pointer-events-auto rounded-full bg-black/70 p-2 text-white shadow-lg backdrop-blur-xs transition-transform group-hover/poster:scale-110 hover:bg-black/90 active:scale-95"
                    title="播放视频"
                  >
                    <Play size={16} className="fill-current translate-x-0.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Hover Frame Extraction Buttons */}
            <div className="nodrag absolute left-1.5 top-1.5 flex flex-col items-start gap-1 opacity-0 transition-opacity group-hover/video:opacity-100 z-10">
              {(['start', 'end', 'current'] as const).map((pick) => (
                <button
                  key={pick}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    extractFrame(pick);
                  }}
                  disabled={framePick !== null}
                  className="inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-[10px] font-medium text-white hover:bg-black/80 backdrop-blur-xs disabled:opacity-50 transition-colors"
                  title={
                    pick === 'start'
                      ? '抽取首帧为图片节点，用作下一镜的起始帧'
                      : pick === 'end'
                        ? '抽取尾帧为图片节点，用作下一镜的起始帧'
                        : '抽取当前播放帧为图片节点'
                  }
                >
                  {framePick === pick ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Camera size={11} />
                  )}
                  {pick === 'start' ? '抽首帧' : pick === 'end' ? '抽尾帧' : '抽当前帧'}
                </button>
              ))}
            </div>

            {frameError ? (
              <div className="absolute inset-x-2 bottom-9 rounded bg-danger/90 px-2 py-1 text-[10px] text-white shadow z-20">
                {frameError}
              </div>
            ) : null}

            {/* Version Switcher if multiple assets */}
            {assets.length > 1 ? (
              <div className="absolute inset-x-0 bottom-7 flex items-center justify-center gap-1.5 bg-black/60 py-1 px-2 backdrop-blur-[2px] z-20">
                {assets.map((_, i) => (
                  <div key={i} className="group/thumb relative flex items-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssetIdx(i);
                        void canvasStore.updateNodeOutput(sessionId, node.id, {
                          ...node.output,
                          activeAssetIndex: i,
                        });
                      }}
                      className={cn(
                        'nodrag rounded px-2 py-0.5 text-[9px] font-medium transition-colors',
                        i === assetIdx
                          ? 'bg-accent text-accent-ink font-semibold shadow-sm'
                          : 'bg-black/60 text-white/80 hover:bg-black/80',
                      )}
                      title={`变体 ${i + 1} / ${assets.length} (点击切换当前视频)`}
                    >
                      v{i + 1}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void canvasStore.removeNodeAsset(sessionId, node.id, i);
                      }}
                      className="nodrag absolute -top-1.5 -right-1.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-danger text-white shadow-xs group-hover/thumb:flex hover:scale-110 transition-transform z-30"
                      title="删除该变体"
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Hover Bottom Bar with Prompt Peek & Quick Rerun */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 transition-opacity group-hover/video:opacity-100 z-10">
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
            <div className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/video:opacity-100 z-10">
              <a
                href={assetUrl!}
                download
                onClick={(e) => e.stopPropagation()}
                className="nodrag rounded-md bg-black/60 p-1 text-white hover:bg-black/80 transition-colors backdrop-blur-xs"
                title="下载视频"
              >
                <Download size={12} />
              </a>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void canvasStore.saveAsset(sessionId, node.id, assetIdx);
                }}
                className="nodrag rounded-md bg-black/60 p-1 text-white hover:bg-black/80 transition-colors backdrop-blur-xs"
                title="存到作品库"
              >
                <FolderPlus size={12} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Upstream Connected Ready State (when no video yet and upstream prompt or start frame exists) */}
      {!hasVideo && (hasUpstreamPrompt || hasUpstreamStartFrame) ? (
        <div className="mt-1 flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-accent/40 bg-accent/5 p-4 text-center select-none">
          <Sparkles size={20} className="text-accent mb-1.5 animate-pulse-subtle pointer-events-none" />
          <span className="text-xs font-semibold text-ink pointer-events-none">
            已接入上游{hasUpstreamPrompt && hasUpstreamStartFrame ? '提示词与首帧' : hasUpstreamStartFrame ? '首帧' : '提示词'}
          </span>
          <p className="mt-1 text-[10px] text-ink-muted leading-relaxed pointer-events-none">
            {hasUpstreamStartFrame ? '将基于上游图像生成连贯动态' : '由上游便签或 Agent 节点提供分镜描述'}
          </p>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="nodrag mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-ink shadow-md hover:opacity-95 active:scale-98 transition-all disabled:opacity-40"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} className="fill-current" />}
            生成视频
            <span className="text-[9px] opacity-75 font-normal ml-0.5">(~{estimateNodeCost(node)}点)</span>
          </button>
        </div>
      ) : null}

      {/* Clean Cover Placeholder (when standalone and no video yet) */}
      {!hasVideo && !hasUpstreamPrompt && !hasUpstreamStartFrame ? (
        <div
          className="group/placeholder relative flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-line hover:border-accent/60 bg-black/20 hover:bg-black/30 p-4 text-center transition-all select-none"
          title="点击卡片配置参数"
        >
          <div className="rounded-full bg-paper-inset/70 p-3 mb-2 text-ink-muted group-hover/placeholder:text-accent group-hover/placeholder:bg-accent/15 group-hover/placeholder:scale-110 transition-all shadow-xs pointer-events-none">
            <Video size={22} />
          </div>
          <span className="text-xs font-medium text-ink-muted group-hover/placeholder:text-ink pointer-events-none transition-colors">待配置视频分镜</span>
        </div>
      ) : null}

      {/* TapNow floating generation panel with inverse-scale compensation */}
      <NodeFloatingPanel
        sessionId={sessionId}
        node={node}
        visible={Boolean(selected || showConfig)}
        nodeType="video"
        prompt={prompt}
        onPromptChange={setPrompt}
        onPromptCommit={commitPrompt}
        candidates={candidates}
        upstreamSources={upstreamSources}
        running={running}
        onRun={run}
        ratio={(params.ratio as '16:9' | '9:16' | '1:1') || '16:9'}
        onRatioChange={(r) => {
          void canvasStore.updateNodeParams(sessionId, node.id, { ...params, ratio: r });
        }}
        duration={(params.duration as '5s' | '10s') || '5s'}
        onDurationChange={(d) => {
          void canvasStore.updateNodeParams(sessionId, node.id, { ...params, duration: d });
        }}
        model={params.model || 'kling-1.5'}
        onModelChange={(m) => {
          void canvasStore.updateNodeParams(sessionId, node.id, { ...params, model: m });
        }}
        camera={params.camera}
        onCameraChange={(cam) => {
          void canvasStore.updateNodeParams(sessionId, node.id, { ...params, camera: cam });
        }}
        estimatedCost={estimateNodeCost(node)}
      />
    </div>
  );
}

export default memo(VideoNode, (prev, next) => {
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
    prevData.hasUpstreamStartFrame === nextData.hasUpstreamStartFrame &&
    prevData.readiness === nextData.readiness &&
    prevData.node === nextData.node
  );
});
