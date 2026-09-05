import React, { memo, useMemo, useRef } from 'react';
import { useStore } from '@xyflow/react';
import {
  Play,
  Loader2,
  Sparkles,
  Type,
  ImageIcon,
  Video,
  Bot,
  X,
  Volume2,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import MentionTextArea, { type MentionTextAreaHandle } from './MentionTextArea';
import { parseMentionTokens, serializeMention } from '../../../shared/resolveMentions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  CANVAS_IMAGE_MODELS,
  CANVAS_VIDEO_MODELS,
  type CanvasNode,
} from '../../../shared/canvas';
import CameraDial from './CameraDial';
import type { CameraControl } from '../../../shared/cameraMotion';
import * as canvasStore from '../../state/canvasStore';

export interface UpstreamSourceItem {
  edgeId: string;
  sourceNodeId: string;
  sourceType: string;
  sourceTitle: string;
  handleId?: string | null;
}

export interface NodeFloatingPanelProps {
  sessionId: string;
  node: CanvasNode;
  visible: boolean;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onPromptCommit: () => void;
  candidates: CanvasNode[];
  upstreamSources: UpstreamSourceItem[];
  running: boolean;
  onRun: () => void;
  nodeType?: 'image' | 'video';
  autoFocus?: boolean;
  // Image specific controls
  size?: '1024x1024' | '1024x1536' | '1536x1024';
  onSizeChange?: (size: '1024x1024' | '1024x1536' | '1536x1024') => void;
  model?: string;
  onModelChange?: (model: string) => void;
  variationsCount?: 1 | 2 | 4;
  onVariationsCountChange?: (count: 1 | 2 | 4) => void;
  estimatedCost?: number;
  // Video specific controls
  ratio?: '16:9' | '9:16' | '1:1';
  onRatioChange?: (ratio: '16:9' | '9:16' | '1:1') => void;
  duration?: '5s' | '10s';
  onDurationChange?: (duration: '5s' | '10s') => void;
  camera?: CameraControl;
  onCameraChange?: (camera: CameraControl) => void;
}

/**
 * TapNow-style floating generation panel:
 * - Unfolds directly below the node when selected.
 * - Applies inverse zoom compensation (`--float-scale = 1 / zoom`), ensuring the panel
 *   maintains a stable, crisp, and comfortable ~680px physical width across canvas zooms (0.15x to 2.0x).
 * - Houses upstream context pills, prompt MentionTextArea, model, aspect ratio, variations count, and generate button.
 */
function NodeFloatingPanel({
  sessionId,
  node,
  visible,
  prompt,
  onPromptChange,
  onPromptCommit,
  candidates,
  upstreamSources,
  running,
  onRun,
  nodeType = 'image',
  autoFocus = false,
  size = '1024x1024',
  onSizeChange,
  model,
  onModelChange,
  variationsCount = 1,
  onVariationsCountChange,
  estimatedCost = 5,
  ratio = '16:9',
  onRatioChange,
  duration = '5s',
  onDurationChange,
  camera,
  onCameraChange,
}: NodeFloatingPanelProps) {
  // Read current canvas zoom level from React Flow store
  const zoom = useStore((s) => s.transform[2]) || 1;
  // Inverse scale: 1 / zoom, clamped safely to prevent extreme scales (down to 0.1x zoom)
  const floatScale = Math.min(10, Math.max(0.5, 1 / zoom));

  const isVideo = nodeType === 'video';
  const defaultModel = isVideo ? 'kling-1.5' : 'flux-schnell';
  const currentModel = model || defaultModel;
  const modelList = isVideo ? CANVAS_VIDEO_MODELS : CANVAS_IMAGE_MODELS;

  const hasUpstreamPrompt = upstreamSources.some(
    (s) => s.sourceType === 'note' || s.sourceType === 'agent',
  );
  const hasUpstreamStartFrame = upstreamSources.some(
    (s) => s.handleId === 'start_frame' || (s.sourceType === 'image' && isVideo),
  );
  const canGenerate = Boolean(
    prompt.trim() || hasUpstreamPrompt || (isVideo && hasUpstreamStartFrame),
  );

  const getSourceIcon = (source: UpstreamSourceItem) => {
    if (source.handleId === 'audio_in') return <Volume2 size={11} className="text-amber-400" />;
    switch (source.sourceType) {
      case 'note':
        return <Type size={11} className="text-emerald-400" />;
      case 'image':
        return <ImageIcon size={11} className="text-indigo-400" />;
      case 'video':
        return <Video size={11} className="text-rose-400" />;
      case 'audio':
        return <Volume2 size={11} className="text-amber-400" />;
      case 'agent':
        return <Bot size={11} className="text-sky-400" />;
      default:
        return <Sparkles size={11} className="text-accent" />;
    }
  };

  const getSourceRoleBadge = (source: UpstreamSourceItem) => {
    if (source.handleId === 'start_frame') return '首帧';
    if (source.handleId === 'end_frame') return '尾帧';
    if (source.handleId === 'reference' || source.handleId?.startsWith('ref_')) return '参考';
    if (source.handleId === 'audio_in') return '配乐';
    if (source.sourceType === 'image') return isVideo ? '首帧' : '参考';
    if (source.sourceType === 'video') return '前序视频';
    if (source.sourceType === 'audio') return '配乐';
    if (source.sourceType === 'note' || source.sourceType === 'agent') return '提示词';
    return null;
  };

  const mentionAreaRef = useRef<MentionTextAreaHandle>(null);

  // 1. Deduplicate upstream sources by sourceNodeId to eliminate redundant badges
  const uniqueUpstreamSources = useMemo(() => {
    const seen = new Set<string>();
    const out: UpstreamSourceItem[] = [];
    for (const s of upstreamSources) {
      if (!seen.has(s.sourceNodeId)) {
        seen.add(s.sourceNodeId);
        out.push(s);
      }
    }
    return out;
  }, [upstreamSources]);

  // 2. Identify which upstream nodes are already explicitly referenced in the prompt text
  const mentionedNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const tok of parseMentionTokens(prompt)) {
      if (tok.type === 'mention') set.add(tok.id);
    }
    return set;
  }, [prompt]);

  // 3. Only display quick insertion buttons for connected upstream sources that are NOT yet mentioned inline
  const unmentionedSources = useMemo(() => {
    return uniqueUpstreamSources.filter((s) => !mentionedNodeIds.has(s.sourceNodeId));
  }, [uniqueUpstreamSources, mentionedNodeIds]);

  const pinnedNodeIds = useMemo(
    () => uniqueUpstreamSources.map((s) => s.sourceNodeId),
    [uniqueUpstreamSources],
  );

  const handleInsertSource = (source: UpstreamSourceItem) => {
    const targetNode = candidates.find((c) => c.id === source.sourceNodeId);
    if (targetNode && mentionAreaRef.current) {
      mentionAreaRef.current.insertMentionNode(targetNode);
    } else {
      const token = `${serializeMention(source.sourceTitle, source.sourceNodeId)} `;
      const next = prompt.trim() ? `${prompt.trim()} ${token}` : token;
      onPromptChange(next);
    }
  };

  const placeholder = isVideo
    ? hasUpstreamPrompt
      ? '已接入上游提示词，可在此输入镜头运镜与动作细节…'
      : hasUpstreamStartFrame
        ? '已接入首帧，描述画面的动态变化与运镜走向…'
        : '描述画面动态、主体动作与运镜轨迹（可输入 @ 引用其他节点画面）…'
    : hasUpstreamPrompt
      ? '已接入上游提示词，可在此输入补充修饰词或风格细节…'
      : '描述画面的主体、光影与艺术质感（可输入 @ 引用其他节点画面）…';

  if (!visible) return null;

  return (
    <div
      className="nodrag nopan nowheel absolute top-full left-1/2 -translate-x-1/2 mt-2.5 z-40 pointer-events-auto"
      style={{
        transform: `translateX(-50%) scale(${floatScale})`,
        transformOrigin: 'top center',
        width: 680,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-2 rounded-2xl border border-line/50 bg-[#161618]/95 dark:bg-[#161618]/95 p-3 text-xs shadow-2xl backdrop-blur-xl transition-all">
        {/* 1. Context Sources Bar: Clean, deduplicated, unmentioned-only helper */}
        {unmentionedSources.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap pb-0.5 text-[11px]">
            <span className="text-[10px] font-medium text-ink-muted/70 shrink-0 flex items-center gap-1 mr-0.5">
              <Sparkles size={11} className="text-accent" />
              快捷插入引用:
            </span>
            {unmentionedSources.map((source) => {
              const roleBadge = getSourceRoleBadge(source);
              let typeStyle = 'border-line/60 bg-paper-inset/40 text-ink-muted hover:text-accent hover:border-accent/40 hover:bg-accent/10';
              if (source.sourceType === 'note') {
                typeStyle = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50';
              } else if (source.sourceType === 'image') {
                typeStyle = 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 hover:border-indigo-500/50';
              } else if (source.sourceType === 'video') {
                typeStyle = 'border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:border-rose-500/50';
              } else if (source.sourceType === 'audio') {
                typeStyle = 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50';
              } else if (source.sourceType === 'agent') {
                typeStyle = 'border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 hover:border-sky-500/50';
              }

              return (
                <button
                  key={source.sourceNodeId}
                  type="button"
                  onClick={() => handleInsertSource(source)}
                  className={cn(
                    'group inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-all cursor-pointer shadow-xs',
                    typeStyle,
                  )}
                  title={`点击将「${source.sourceTitle}」作为行内 @ 胶囊插入提示词`}
                >
                  {getSourceIcon(source)}
                  {roleBadge ? (
                    <span className="text-[9px] opacity-80 font-medium">
                      {roleBadge}
                    </span>
                  ) : null}
                  <span className="max-w-[120px] truncate font-normal">
                    + @{source.sourceTitle}
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      void canvasStore.removeEdge(sessionId, source.edgeId);
                    }}
                    title="移除此上游连线"
                    className="ml-0.5 opacity-40 hover:opacity-100 hover:text-danger p-0.5 rounded transition-colors"
                  >
                    <X size={9} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* 2. MentionTextArea Prompt Input (Rich inline chips, flat, borderless) */}
        <div className="relative px-1 pt-0.5">
          <MentionTextArea
            ref={mentionAreaRef}
            variant="flat"
            value={prompt}
            onChange={onPromptChange}
            onCommit={onPromptCommit}
            candidates={candidates}
            pinnedNodeIds={pinnedNodeIds}
            onChipClick={(nodeId) => canvasStore.focusNode(sessionId, nodeId)}
            placeholder={placeholder}
            minRows={2}
            autoFocus={autoFocus}
            className="text-[13px] text-ink placeholder:text-ink-muted/40 leading-relaxed font-normal"
            onMentionSelect={(refNode) => {
              void canvasStore.connectNodes(
                sessionId,
                refNode.id,
                node.id,
                'result',
                'prompt',
              );
            }}
          />
        </div>

        {/* 3. Parameter Controls Bar (De-boxed, minimal inline segments) */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-line/25">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Model Selector (Flat trigger button) */}
            {onModelChange ? (
              <Select value={currentModel} onValueChange={onModelChange}>
                <SelectTrigger className="h-7 w-auto px-2 text-[11px] font-medium bg-transparent hover:bg-paper-inset/70 border-0 shadow-none text-ink-muted hover:text-ink transition-colors gap-1 focus:ring-0 focus-visible:ring-0 focus:outline-none data-[size=default]:h-7">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent className="z-[150] text-xs">
                  {modelList.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      <div className="flex items-center justify-between gap-1.5 w-full">
                        <span>{m.name}</span>
                        {'badge' in m && m.badge ? (
                          <span className="rounded bg-accent/20 px-1 py-0.2 text-[9px] text-accent">
                            {m.badge}
                          </span>
                        ) : null}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {/* Subtle separator */}
            <div className="w-px h-3 bg-line/40 mx-0.5" />

            {/* Video Ratio vs Image Size (Borderless segment controls) */}
            {isVideo && onRatioChange ? (
              <div className="flex items-center gap-0.5 text-[10px]">
                {(['16:9', '9:16', '1:1'] as const).map((r) => {
                  const active = ratio === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => onRatioChange(r)}
                      className={cn(
                        'rounded-md px-1.5 py-0.5 font-medium transition-colors',
                        active
                          ? 'bg-paper-inset text-ink font-semibold shadow-2xs'
                          : 'text-ink-muted hover:text-ink hover:bg-paper-inset/40',
                      )}
                      title={`画幅比例: ${r}`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            ) : !isVideo && onSizeChange ? (
              <div className="flex items-center gap-0.5 text-[10px]">
                {(['1024x1024', '1024x1536', '1536x1024'] as const).map((sz) => {
                  const label = sz === '1024x1024' ? '1:1' : sz === '1024x1536' ? '9:16' : '16:9';
                  const active = size === sz;
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => onSizeChange(sz)}
                      className={cn(
                        'rounded-md px-1.5 py-0.5 font-medium transition-colors',
                        active
                          ? 'bg-paper-inset text-ink font-semibold shadow-2xs'
                          : 'text-ink-muted hover:text-ink hover:bg-paper-inset/40',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* Subtle separator */}
            <div className="w-px h-3 bg-line/40 mx-0.5" />

            {/* Video Duration (5s, 10s) */}
            {isVideo && onDurationChange ? (
              <div className="flex items-center gap-0.5 text-[10px]">
                {(['5s', '10s'] as const).map((d) => {
                  const active = duration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onDurationChange(d)}
                      className={cn(
                        'rounded-md px-1.5 py-0.5 font-medium transition-colors',
                        active
                          ? 'bg-paper-inset text-ink font-semibold shadow-2xs'
                          : 'text-ink-muted hover:text-ink hover:bg-paper-inset/40',
                      )}
                      title={`视频时长: ${d}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* Cinema Lab Multi-Axis Camera Motion Dial */}
            {isVideo && onCameraChange ? (
              <CameraDial value={camera} onChange={onCameraChange} />
            ) : null}

            {/* Variations Count Pills for Image (1x, 2x, 4x) */}
            {!isVideo && onVariationsCountChange ? (
              <div className="flex items-center gap-0.5 text-[10px]">
                {([1, 2, 4] as const).map((c) => {
                  const active = variationsCount === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => onVariationsCountChange(c)}
                      className={cn(
                        'rounded-md px-1.5 py-0.5 font-medium transition-colors',
                        active
                          ? 'bg-accent/15 text-accent font-semibold'
                          : 'text-ink-muted hover:text-ink hover:bg-paper-inset/40',
                      )}
                      title={`并发生成 ${c} 张变体`}
                    >
                      {c}×
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Right: Price & Generate CTA Button (Single bold highlight) */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-ink-muted/70 tabular-nums">
              ~{estimatedCost * (isVideo ? 1 : variationsCount)} 点
            </span>

            <button
              type="button"
              onClick={onRun}
              disabled={running || !canGenerate}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-ink shadow-md transition-all',
                running || !canGenerate
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:opacity-95 active:scale-95 hover:shadow-lg',
              )}
            >
              {running ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  <span>生成中…</span>
                </>
              ) : (
                <>
                  {isVideo ? <Video size={11} className="fill-current" /> : <Play size={11} className="fill-current" />}
                  <span>
                    {isVideo
                      ? '生成视频'
                      : variationsCount > 1
                        ? `生成 ${variationsCount} 张变体`
                        : '生成图片'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(NodeFloatingPanel);
