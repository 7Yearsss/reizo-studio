import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { NodeResizer, Position, type NodeProps, type ResizeParams, useStore } from '@xyflow/react';
import { Download, FolderPlus, Loader2, Play, GitBranchPlus, Bot, Video, Camera, SlidersHorizontal, Sparkles, RotateCw } from 'lucide-react';
import type { CanvasVideoParams } from '../../../shared/canvas';
import { CANVAS_VIDEO_MODELS, getVideoModelCapabilities } from '../../../shared/canvas';
import { estimateNodeCost } from '../../../shared/canvasPricing';
import { cameraFromPreset } from '../../../shared/cameraMotion';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { cn } from '../../lib/cn';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import MentionTextArea from './MentionTextArea';
import CameraDial from './CameraDial';
import NodeActionBar, { useHoverIntent, type NodeAction } from './NodeActionBar';
import NodeHandle from './NodeHandle';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { useAssetUrl } from './useAssetUrl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

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
  const [assetIdx, setAssetIdx] = useState(0);
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
      <NodeActionBar
        visible={selected || hovered}
        actions={[
          {
            id: 'variations',
            icon: <GitBranchPlus size={11} className="text-accent" />,
            label: '变体 ×4',
            title: '在右侧并排派生 4 个继承参数与首尾帧连线的变体',
            onClick: () => void canvasStore.forkVariations(sessionId, node.id),
          },
          ...((assets.length > 0
            ? [
                {
                  id: 'carryFrame',
                  icon: <Camera size={11} className="text-accent" />,
                  label: '抽尾帧续拍',
                  title: '把尾帧抽成图片节点，用作下一镜的起始帧',
                  onClick: () => extractFrame('end'),
                },
              ]
            : []) as NodeAction[]),
          {
            id: 'qa',
            icon: <Bot size={11} className="text-accent" />,
            label: '质检 Agent',
            title: '在右侧添加连接的视频质检 Agent 节点',
            onClick: () =>
              void canvasStore.addDownstreamAgent(
                sessionId,
                node.id,
                '请评估该生成的视频分镜，从动作连贯性、光影、画面质感给出点评，并提供优化后的视频 Prompt。',
              ),
          },
          ...((assets.length > 0
            ? [
                {
                  id: 'save',
                  icon: <FolderPlus size={11} className="text-accent" />,
                  label: '存为产物',
                  title: '将当前视频存入作品库',
                  onClick: () => void canvasStore.saveAsset(sessionId, node.id, assetIdx),
                },
              ]
            : []) as NodeAction[]),
        ]}
      />

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

      <NodeHandle
        type="target"
        id="prompt"
        position={Position.Left}
        kind="prompt"
        label="提示词"
        expanded={expanded}
        top="16%"
      />
      <NodeHandle
        type="target"
        id="start_frame"
        position={Position.Left}
        kind="startFrame"
        label="首帧"
        disabled={!caps.startFrame}
        disabledReason="当前模型不支持首帧输入"
        expanded={expanded}
        top="36%"
      />
      <NodeHandle
        type="target"
        id="end_frame"
        position={Position.Left}
        kind="endFrame"
        label="尾帧"
        disabled={!caps.endFrame}
        disabledReason="当前模型不支持尾帧插值"
        expanded={expanded}
        top="56%"
      />
      <NodeHandle
        type="target"
        id="reference"
        position={Position.Left}
        kind="reference"
        label="参考"
        disabled={!caps.reference}
        disabledReason="当前模型不支持角色参考"
        expanded={expanded}
        top="74%"
      />
      <NodeHandle
        type="target"
        id="audio_in"
        position={Position.Left}
        kind="audio"
        label="音频配乐"
        expanded={expanded}
        top="90%"
      />
      <NodeHandle
        type="source"
        id="video_out"
        position={Position.Right}
        kind="video"
        label="视频输出"
        expanded={expanded}
        top="50%"
      />

      {/* Header */}
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Video size={13} className="text-accent shrink-0" />
          <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="视频生成" />
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
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'bg-paper-inset text-ink-muted',
            )}
          >
            {node.runState === 'idle'
              ? '未运行'
              : running
                ? `生成中 ${progress > 0 ? `${progress}%` : '...'}`
                : node.runState === 'done'
                  ? '完成'
                  : '失败'}
          </span>
          {(hasVideo || hasUpstreamPrompt || hasUpstreamStartFrame) && (
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

      {/* Hero Video view (when media exists and config is closed) */}
      {hasVideo && !showConfig ? (
        <div className="group/video relative min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-black/40 flex items-center justify-center">
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
              className="group/poster relative h-full w-full flex items-center justify-center cursor-pointer bg-black/30 overflow-hidden"
              onClick={() => setIsPlaying(true)}
              title="点击播放视频"
            >
              {expanded ? (
                <video
                  src={`${assetUrl}#t=0.001`}
                  preload="metadata"
                  muted
                  playsInline
                  className="nodrag pointer-events-none h-full w-full object-contain opacity-90"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-1.5 text-ink-muted select-none">
                  <Video size={26} className="text-accent/60" />
                  <span className="text-[10px] text-ink-muted/80">点击播放 / 悬浮预览</span>
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/15 group-hover/poster:bg-black/30 transition-colors">
                <div className="rounded-full bg-black/70 p-2 text-white shadow-lg backdrop-blur-xs transition-transform group-hover/poster:scale-110">
                  <Play size={16} className="fill-current translate-x-0.5" />
                </div>
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
            <div className="absolute inset-x-0 bottom-7 flex items-center justify-center gap-1 bg-black/50 py-0.5 backdrop-blur-[2px] z-10">
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
                    i === assetIdx
                      ? 'bg-accent text-accent-ink font-semibold shadow-sm'
                      : 'bg-black/60 text-white/80 hover:bg-black/80',
                  )}
                  title={`版本 v${assets.length - i} (点击切换当前视频)`}
                >
                  v{assets.length - i}
                </button>
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
              title="重新生成视频"
            >
              {running ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={9} />}
              重跑
            </button>
          </div>

          {/* Hover Top Right Action Buttons */}
          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover/video:opacity-100 z-10">
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
      ) : null}

      {/* Upstream Connected Ready State (when no video yet and upstream prompt or start frame exists) */}
      {!hasVideo && (hasUpstreamPrompt || hasUpstreamStartFrame) && !showConfig ? (
        <div className="mt-1 flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-accent/40 bg-accent/5 p-4 text-center">
          <Sparkles size={20} className="text-accent mb-1.5 animate-pulse-subtle" />
          <span className="text-xs font-semibold text-ink">
            已接入上游{hasUpstreamPrompt && hasUpstreamStartFrame ? '提示词与首帧' : hasUpstreamStartFrame ? '首帧' : '提示词'}
          </span>
          <p className="mt-1 text-[10px] text-ink-muted leading-relaxed">
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

      {/* Config / Prompt Input Area (when standalone, or explicitly opened) */}
      {(!hasVideo && !hasUpstreamPrompt && !hasUpstreamStartFrame) || showConfig ? (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="mt-1">
            <MentionTextArea
              value={prompt}
              onChange={setPrompt}
              onCommit={commitPrompt}
              candidates={candidates}
              placeholder="描述画面动态与运镜（输入 @ 可引用画布节点，或从左侧拉出端口连线）…"
              onMentionSelect={(refNode) => {
                void canvasStore.connectNodes(sessionId, refNode.id, node.id, 'reference');
              }}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Video Model Selector */}
              <Select
                value={params.model || 'kling-1.5'}
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
                    <span className="text-accent text-[10px]">🎬</span>
                    <SelectValue placeholder="视频模型" />
                  </div>
                </SelectTrigger>
                <SelectContent className="min-w-[170px] rounded-xl border border-line bg-paper-raised/95 shadow-xl backdrop-blur-xl p-1 text-xs">
                  {CANVAS_VIDEO_MODELS.map((m) => (
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

              {/* Capability status badge row */}
              <div className="flex items-center gap-1 select-none">
                <span
                  title={caps.startFrame ? '支持首帧垫图 (Image-to-Video)' : '当前模型不支持首帧垫图'}
                  className={cn(
                    'rounded px-1 py-0.5 text-[9px] font-mono border transition-colors',
                    caps.startFrame
                      ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-line text-ink-muted/50 opacity-60',
                  )}
                >
                  首帧 {caps.startFrame ? '✓' : '✗'}
                </span>
                <span
                  title={caps.endFrame ? '支持尾帧插值 (Start & End Frame)' : '当前模型不支持尾帧插值'}
                  className={cn(
                    'rounded px-1 py-0.5 text-[9px] font-mono border transition-colors',
                    caps.endFrame
                      ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-line text-ink-muted/50 opacity-60',
                  )}
                >
                  尾帧 {caps.endFrame ? '✓' : '✗'}
                </span>
                <span
                  title={caps.camera ? '支持精细多轴运镜控制' : '当前模型不支持运镜控制'}
                  className={cn(
                    'rounded px-1 py-0.5 text-[9px] font-mono border transition-colors',
                    caps.camera
                      ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-line text-ink-muted/50 opacity-60',
                  )}
                >
                  运镜 {caps.camera ? '✓' : '✗'}
                </span>
              </div>

              {/* Visual camera-motion controller (direction + intensity per axis) */}
              <CameraDial
                value={params.camera ?? cameraFromPreset(params.cameraMotion)}
                onChange={(camera) =>
                  void canvasStore.updateNodeParams(sessionId, node.id, { ...params, camera })
                }
              />

              {/* Ratio Segmented Pills (16:9, 9:16, 1:1) */}
              <div className="flex items-center rounded-lg border border-line/60 bg-paper-inset/50 p-0.5">
                {['16:9', '9:16', '1:1'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      void canvasStore.updateNodeParams(sessionId, node.id, {
                        ...params,
                        ratio: r as CanvasVideoParams['ratio'],
                      })
                    }
                    className={cn(
                      'nodrag rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all',
                      (params.ratio || '16:9') === r
                        ? 'bg-paper-raised text-ink border border-line/60 shadow-xs font-semibold dark:bg-white/15 dark:text-white dark:border-white/20'
                        : 'text-ink-muted hover:text-ink',
                    )}
                    title={`画幅比例: ${r}`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Duration Segmented Pills (5s, 10s) */}
              <div className="flex items-center rounded-lg border border-line/60 bg-paper-inset/50 p-0.5">
                {(['5s', '10s'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      void canvasStore.updateNodeParams(sessionId, node.id, {
                        ...params,
                        duration: d as CanvasVideoParams['duration'],
                      })
                    }
                    className={cn(
                      'nodrag rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all',
                      (params.duration || '5s') === d
                        ? 'bg-paper-raised text-ink border border-line/60 shadow-xs font-semibold dark:bg-white/15 dark:text-white dark:border-white/20'
                        : 'text-ink-muted hover:text-ink',
                    )}
                    title={`视频时长: ${d}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={run}
              disabled={running || (!prompt.trim() && !hasUpstreamPrompt && !hasUpstreamStartFrame)}
              title={`生成视频 (单次预计消耗约 ${estimateNodeCost(node)} 算力点)`}
              className="nodrag ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent text-accent-ink px-3 py-1 text-[11px] font-medium shadow-xs hover:opacity-90 active:scale-95 transition-all disabled:opacity-40"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} className="fill-current" />}
              生成视频
              <span className="text-[9px] opacity-75 font-normal ml-0.5">(~{estimateNodeCost(node)}点)</span>
            </button>
          </div>

          {running ? (
            <div className="mt-2 w-full overflow-hidden rounded-full bg-paper-inset">
              <div
                className="h-1.5 rounded-full bg-accent transition-all duration-300"
                style={{ width: `${Math.max(5, progress)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
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
