import React, { memo, useMemo, useRef, useState, useEffect } from 'react';
import { useStore } from '@xyflow/react';
import {
  Play,
  Loader2,
  Type,
  Video,
  Bot,
  X,
  Volume2,
  Plus,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import MentionTextArea, { type MentionTextAreaHandle } from './MentionTextArea';
import { useAssetUrl } from './useAssetUrl';
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
  nodeType?: 'image' | 'video' | 'audio' | 'note';
  autoFocus?: boolean;
  // Audio specific controls
  audioProvider?: string;
  onAudioProviderChange?: (provider: string) => void;
  audioProviders?: Array<{ id: string; name: string; isDefault?: boolean }>;
  audioVoice?: string;
  onAudioVoiceChange?: (voice: string) => void;
  audioVoices?: Array<{ id: string; name: string; tag?: string }>;
  // Note specific controls
  onAgentExpand?: () => void;
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
  audioProvider,
  onAudioProviderChange,
  audioProviders,
  audioVoice,
  onAudioVoiceChange,
  audioVoices,
  onAgentExpand,
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

  // Read the node's dragging flag straight from the RF store — same source RF uses
  // internally, so it flips to true the instant the drag starts with zero lag.
  const isDragging = useStore((s) => {
    const rfNode = s.nodes.find((n) => n.id === node.id);
    return rfNode?.dragging ?? false;
  });

  // Debounced render gate:
  //   - When visible+notDragging, we wait 100ms before actually showing.
  //     If isDragging becomes true within that window (drag started), the timer
  //     is cancelled and the panel never renders at all → zero flash at drag start.
  //   - When isDragging becomes true (mid-drag) shouldRender drops to false immediately.
  //   - When drag ends (isDragging→false, visible still true), the 100ms runs again
  //     and the panel appears after the node has settled at its new position.
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    // Immediately hide whenever the caller hides it or the node is being dragged
    if (!visible || isDragging) {
      setShouldRender(false);
      return;
    }
    // Defer show so a drag-start that happens within the delay cancels the render
    const timer = setTimeout(() => setShouldRender(true), 100);
    return () => clearTimeout(timer);
  }, [visible, isDragging]);

  // ── All hooks must be called before any early return (Rules of Hooks) ──────

  const mentionAreaRef = useRef<MentionTextAreaHandle>(null);

  // Register the insert callback while this panel is showing. Do not clear the
  // composer on hide/remount — a mention pick updates node params, RF rebuilds
  // the node, and a 100ms shouldRender dip would otherwise wipe the prompt.
  useEffect(() => {
    if (!shouldRender) return;
    canvasStore.setMentionComposer(sessionId, node.id, (src) => {
      mentionAreaRef.current?.insertMentionNode(src);
    });
  }, [shouldRender, sessionId, node.id]);

  // Keep inbound reference/prompt wires in lockstep with inline @ chips.
  // The thumbnail strip is only a palette — it must not leave orphan edges.
  useEffect(() => {
    if (!shouldRender) return;
    void canvasStore.syncMentionWires(sessionId, node.id, prompt);
  }, [shouldRender, prompt, sessionId, node.id]);

  const visualRefs = useMemo(() => {
    const ids = canvasStore.composerRefIds(node);
    return ids
      .map((id) => candidates.find((c) => c.id === id))
      .filter((n): n is CanvasNode => Boolean(n));
  }, [node, candidates]);

  const pinnedNodeIds = useMemo(
    () => visualRefs.map((n) => n.id),
    [visualRefs],
  );

  // ── Early return after all hooks ─────────────────────────────────────────
  if (!shouldRender) return null;

  // ── Non-hook computations (safe after the early return) ──────────────────
  const isVideo = nodeType === 'video';
  const isAudio = nodeType === 'audio';
  const isNote = nodeType === 'note';
  const isImage = !isVideo && !isAudio && !isNote;

  const defaultModel = isVideo ? 'kling-1.5' : isAudio ? (audioProviders?.[0]?.id || 'suno-v3') : 'flux-schnell';
  const currentModel = model || defaultModel;
  const modelList = isVideo ? CANVAS_VIDEO_MODELS : CANVAS_IMAGE_MODELS;

  const hasUpstreamPrompt = upstreamSources.some(
    (s) => s.sourceType === 'note' || s.sourceType === 'agent',
  );
  const hasUpstreamStartFrame = upstreamSources.some(
    (s) => s.handleId === 'start_frame' || (s.sourceType === 'image' && isVideo),
  );
  const canGenerate = isNote
    ? Boolean(prompt.trim() || hasUpstreamPrompt)
    : Boolean(prompt.trim() || hasUpstreamPrompt || (isVideo && hasUpstreamStartFrame));

  const placeholder = isVideo
    ? hasUpstreamPrompt
      ? '已接入上游提示词，可在此输入镜头运镜与动作细节…'
      : hasUpstreamStartFrame
        ? '已接入首帧，描述画面的动态变化与运镜走向…'
        : '描述画面动态、主体动作与运镜轨迹（可输入 @ 引用其他节点画面）…'
    : isAudio
      ? hasUpstreamPrompt
        ? '已接入上游文本，输入音效风格、配乐情绪或旁白提示…'
        : '描述所需配乐情绪、音效风格或旁白台词（可输入 @ 引用节点）…'
      : isNote
        ? '输入分镜剧本、提示词、旁白台词或灵感（输入 @ 可引用画布节点）…'
        : hasUpstreamPrompt
          ? '已接入上游提示词，可在此输入补充修饰词或风格细节…'
          : '描述画面的主体、光影与艺术质感（可输入 @ 引用其他节点画面）…';


  return (
    <div
      data-mention-composer={node.id}
      className="nodrag nopan nowheel absolute top-full left-1/2 mt-2.5 z-40 pointer-events-auto cursor-default"
      style={{
        // Don't also use Tailwind -translate-x-1/2: v4's `translate` property
        // would stack with this `transform` and shove the panel left.
        transform: `translateX(-50%) scale(${floatScale})`,
        transformOrigin: 'top center',
        width: 680,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-2 rounded-2xl border border-line/50 bg-[#161618]/95 dark:bg-[#161618]/95 p-3 text-xs shadow-2xl backdrop-blur-xl transition-all cursor-default">
        <div className="flex items-center gap-2 px-0.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
            {visualRefs.map((srcNode) => (
                <RefChip
                  key={srcNode.id}
                  node={srcNode}
                  title={srcNode.title || '节点'}
                  onInsert={() => mentionAreaRef.current?.insertMentionNode(srcNode)}
                  onRemove={() => void canvasStore.removeComposerRef(sessionId, node.id, srcNode.id)}
                />
            ))}
            <button
              type="button"
              onClick={() => canvasStore.startPickingCanvasRefs(sessionId, node.id)}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-dashed border-line/70 px-2 text-[11px] text-ink-muted hover:text-ink hover:border-ink-muted/50 cursor-pointer"
            >
              <Plus size={13} />
              参考
            </button>
            {visualRefs.length > 0 ? (
              <span className="shrink-0 text-[11px] text-amber-200/80">参考图 {visualRefs.length} 张</span>
            ) : null}
          </div>
        </div>

        {/* 2. MentionTextArea Prompt Input (Rich inline chips, flat, borderless) */}
        <div className="relative px-1 pt-0.5 cursor-text">
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
            onComposerActive={() =>
              canvasStore.setMentionComposer(sessionId, node.id, (src) => {
                mentionAreaRef.current?.insertMentionNode(src);
              })
            }
            onMentionSelect={(refNode) => {
              void canvasStore.connectMention(sessionId, node.id, refNode);
            }}
            onMentionRemove={(sourceId) => {
              void canvasStore.disconnectMention(sessionId, node.id, sourceId);
            }}
          />
        </div>

        {/* 3. Parameter Controls Bar (De-boxed, minimal inline segments) */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-line/25">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Audio Mode: Provider & Voice Selectors */}
            {isAudio ? (
              <>
                {audioProviders && audioProviders.length > 0 && onAudioProviderChange ? (
                  <Select value={audioProvider || audioProviders.find((p) => p.isDefault)?.id || audioProviders[0]?.id} onValueChange={onAudioProviderChange}>
                    <SelectTrigger className="h-7 w-auto px-2 text-[11px] font-medium bg-transparent hover:bg-paper-inset/70 border-0 shadow-none text-ink-muted hover:text-ink transition-colors gap-1 focus:ring-0 focus-visible:ring-0 focus:outline-none data-[size=default]:h-7">
                      <SelectValue placeholder="选择服务商" />
                    </SelectTrigger>
                    <SelectContent className="z-[150] text-xs">
                      {audioProviders.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">
                          {p.name} {p.isDefault ? '★' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                {audioVoices && audioVoices.length > 0 ? (
                  <div className="flex items-center gap-1 max-w-[220px] overflow-x-auto no-scrollbar">
                    {audioVoices.slice(0, 4).map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onAudioVoiceChange?.(v.id)}
                        className={cn(
                          'rounded-md px-1.5 py-0.5 font-medium transition-colors shrink-0 text-[9px]',
                          audioVoice === v.id
                            ? 'bg-accent/15 text-accent font-semibold'
                            : 'text-ink-muted hover:text-ink hover:bg-paper-inset/40',
                        )}
                        title={v.tag ? `${v.name} (${v.tag})` : v.name}
                      >
                        {v.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : isNote ? (
              /* Note Mode: Text tag */
              <div className="flex items-center gap-1 text-[10px] text-ink-muted/80">
                <Type size={11} className="text-emerald-400 shrink-0" />
                <span className="font-medium text-ink-muted">剧本与提示词编辑器</span>
              </div>
            ) : (
              /* Image / Video Model Selector (Flat trigger button) */
              <>
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
              </>
            )}
          </div>

          {/* Right: Price & Generate / Action CTA Button */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-ink-muted/70 tabular-nums">
              {isNote ? 'Agent 协作' : `~${(isAudio ? 3 : estimatedCost) * (isVideo || isAudio ? 1 : variationsCount)} 点`}
            </span>

            <button
              type="button"
              onClick={isNote && onAgentExpand ? onAgentExpand : onRun}
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
                  <span>{isNote ? '扩写中…' : '生成中…'}</span>
                </>
              ) : (
                <>
                  {isNote ? (
                    <Bot size={11} className="shrink-0" />
                  ) : isAudio ? (
                    <Volume2 size={11} className="fill-current shrink-0" />
                  ) : isVideo ? (
                    <Video size={11} className="fill-current shrink-0" />
                  ) : (
                    <Play size={11} className="fill-current shrink-0" />
                  )}
                  <span>
                    {isNote
                      ? 'Agent 扩写'
                      : isAudio
                        ? '生成音频'
                        : isVideo
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

function RefChip({
  node,
  title,
  onInsert,
  onRemove,
}: {
  node?: CanvasNode;
  title: string;
  onInsert: () => void;
  onRemove: () => void;
}) {
  const rel =
    node?.output?.assets?.[node.output.activeAssetIndex ?? 0] ??
    node?.output?.assets?.[0];
  const url = useAssetUrl(rel);
  return (
    <button
      type="button"
      onClick={onInsert}
      title={`插入 @${title}`}
      className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-line/50 bg-paper-inset/60"
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[9px] text-ink-muted">
          {title.slice(0, 2)}
        </span>
      )}
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute right-0 top-0 hidden h-3.5 w-3.5 items-center justify-center rounded-bl bg-black/70 text-white group-hover:flex"
      >
        <X size={8} />
      </span>
    </button>
  );
}

export default memo(NodeFloatingPanel);
