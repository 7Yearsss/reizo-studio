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
  ArrowUp,
  Sparkles,
  BarChart2,
  Scan,
  SlidersHorizontal,
  Mic,
  Check,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { chromeScale } from './chromeScale';
import { toast } from '../../lib/toast';
import MentionTextArea, { type MentionTextAreaHandle } from './MentionTextArea';
import { useAssetUrl } from './useAssetUrl';
import {
  CANVAS_IMAGE_MODELS,
  CANVAS_VIDEO_MODELS,
  type CanvasNode,
} from '../../../shared/canvas';
import CameraDial from './CameraDial';
import type { CameraControl } from '../../../shared/cameraMotion';
import * as canvasStore from '../../state/canvasStore';
import { useSettingsStore } from '../../state/useSettingsStore';

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
  const floatScale = chromeScale(zoom);

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
  const [paramsOpen, setParamsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [audioProviderOpen, setAudioProviderOpen] = useState(false);

  // Click outside to close dropdowns without blocking clicks to other elements
  useEffect(() => {
    if (!modelOpen && !sizeOpen && !audioProviderOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-floating-dropdown]')) return;
      setModelOpen(false);
      setSizeOpen(false);
      setAudioProviderOpen(false);
      if (document.body.style.pointerEvents === 'none') {
        document.body.style.pointerEvents = '';
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [modelOpen, sizeOpen, audioProviderOpen]);

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
  const [refining, setRefining] = useState(false);

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
    const timer = setTimeout(() => {
      void canvasStore.syncMentionWires(sessionId, node.id, prompt);
    }, 150);
    return () => clearTimeout(timer);
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

  const handleRefinePrompt = async () => {
    const raw = prompt.trim();
    if (!raw || refining) return;
    setRefining(true);
    try {
      const mode = isVideo ? 'video' : 'image';
      const refined = await canvasStore.refinePrompt(raw, mode);
      onPromptChange(refined);
      onPromptCommit();
      toast.success('已完成提示词润色');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提示词润色失败');
    } finally {
      setRefining(false);
    }
  };

  const mediaModels = useSettingsStore((s) => s.settings.mediaModels);
  const defaultModel = isVideo
    ? mediaModels?.video || 'kling-1.5'
    : isAudio
      ? audioProviders?.[0]?.id || 'suno-v3'
      : mediaModels?.image || 'gpt-image-2.5';
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


  const currentModelName = isAudio
    ? audioProviders?.find((p) => p.id === audioProvider)?.name || audioProvider || 'Suno Music'
    : modelList.find((m) => m.id === currentModel)?.name || currentModel;

  const displayModelName = currentModelName.replace(/\s*\([^)]*\)/, '');

  const sizeLabel = isVideo
    ? ratio === '16:9'
      ? '横屏(16:9)'
      : ratio === '9:16'
        ? '竖屏(9:16)'
        : '方形(1:1)'
    : size === '1024x1536'
      ? '竖屏(9:16)'
      : size === '1536x1024'
        ? '横屏(16:9)'
        : '自适应(4K)';

  const cost = isNote
    ? 'Agent'
    : (isAudio ? 3 : estimatedCost) * (isVideo || isAudio ? 1 : variationsCount);

  const cycleVariations = () => {
    if (!onVariationsCountChange) return;
    const next = variationsCount === 1 ? 2 : variationsCount === 2 ? 4 : 1;
    onVariationsCountChange(next);
  };

  return (
    <div
      data-mention-composer={node.id}
      className="nodrag nopan nowheel absolute top-full left-1/2 mt-2.5 z-40 pointer-events-auto cursor-default select-none"
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
      <div className="flex flex-col gap-2 rounded-[24px] border border-white/[0.08] bg-[#18181a] p-3.5 text-xs shadow-[0_20px_48px_-10px_rgba(0,0,0,0.7)] backdrop-blur-2xl transition-all cursor-default">
        {/* 1. References row */}
        <div className="flex items-center gap-2 px-0.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar py-0.5">
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
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[11px] text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <Plus size={13} />
              <span>参考</span>
            </button>
            {visualRefs.length > 0 ? (
              <span className="shrink-0 text-[11px] text-white/40">参考图 {visualRefs.length} 张</span>
            ) : null}
          </div>
        </div>

        {/* 2. MentionTextArea Prompt Input (Pure typography, flat) */}
        <div
          className="relative px-1 pt-0.5 pb-1 cursor-text min-h-[50px] select-text"
          onClick={() => mentionAreaRef.current?.focus()}
        >
          <MentionTextArea
            key={node.id}
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
            className="text-[14px] text-white/90 placeholder:text-white/30 leading-relaxed font-normal select-text"
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

        {/* Optional Expandable Parameters Drawer */}
        {paramsOpen && (
          <div className="flex items-center gap-3 px-2 py-2 border-t border-white/[0.06] bg-white/[0.02] rounded-xl">
            {isVideo && (
              <>
                {onDurationChange && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-white/40 mr-1">时长:</span>
                    {(['5s', '10s'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => onDurationChange(d)}
                        className={cn(
                          'rounded-lg px-2 py-1 text-xs font-medium transition-colors cursor-pointer',
                          duration === d
                            ? 'bg-white/15 text-white font-semibold'
                            : 'text-white/50 hover:text-white hover:bg-white/[0.06]',
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
                {onCameraChange && (
                  <div className="flex items-center gap-1.5 ml-2 border-l border-white/[0.08] pl-3">
                    <span className="text-[11px] text-white/40">运镜:</span>
                    <CameraDial value={camera} onChange={onCameraChange} />
                  </div>
                )}
              </>
            )}
            {isAudio && audioVoices && audioVoices.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <span className="text-[11px] text-white/40 mr-1 shrink-0">音色:</span>
                {audioVoices.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onAudioVoiceChange?.(v.id)}
                    className={cn(
                      'rounded-lg px-2 py-1 text-xs font-medium transition-colors shrink-0 cursor-pointer',
                      audioVoice === v.id
                        ? 'bg-accent/20 text-accent font-semibold'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.06]',
                    )}
                    title={v.tag ? `${v.name} (${v.tag})` : v.name}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            )}
            {!isVideo && !isAudio && !isNote && onVariationsCountChange && (
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-white/40 mr-1">变体数量:</span>
                {([1, 2, 4] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onVariationsCountChange(c)}
                    className={cn(
                      'rounded-lg px-2 py-1 text-xs font-medium transition-colors cursor-pointer',
                      variationsCount === c
                        ? 'bg-accent/20 text-accent font-semibold'
                        : 'text-white/50 hover:text-white hover:bg-white/[0.06]',
                    )}
                  >
                    {c}x
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. Bottom Controls Bar */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.04]">
          {/* Left Controls */}
          <div className="flex items-center gap-1 min-w-0">
            {isAudio ? (
              /* Audio Provider Selector */
              audioProviders && audioProviders.length > 0 && onAudioProviderChange ? (
                <div className="relative" data-floating-dropdown>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setModelOpen(false);
                      setSizeOpen(false);
                      setAudioProviderOpen((prev) => !prev);
                    }}
                    className={cn(
                      "h-9 w-auto px-2.5 text-[13px] font-medium transition-colors gap-2 rounded-xl cursor-pointer flex items-center select-none",
                      audioProviderOpen
                        ? "bg-white/15 text-white"
                        : "text-white/90 hover:text-white hover:bg-white/[0.06]"
                    )}
                  >
                    <BarChart2 size={16} className="text-white/70 shrink-0" />
                    <span className="font-semibold">{displayModelName}</span>
                  </button>

                  {audioProviderOpen && (
                    <div
                      className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[160px] rounded-2xl border border-white/10 bg-[#1e1e22] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.7)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {audioProviders.map((p) => {
                        const isSelected = (audioProvider || audioProviders[0]?.id) === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              onAudioProviderChange?.(p.id);
                              setAudioProviderOpen(false);
                              mentionAreaRef.current?.focus();
                            }}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer",
                              isSelected
                                ? "bg-white/15 text-white font-medium"
                                : "text-white/70 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            <span>{p.name} {p.isDefault ? '★' : ''}</span>
                            {isSelected ? <Check size={14} className="text-accent shrink-0" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null
            ) : isNote ? (
              /* Note Tag */
              <div className="flex items-center gap-2 h-9 px-2 text-[13px] font-medium text-emerald-400">
                <Type size={15} className="shrink-0" />
                <span>剧本与提示词编辑器</span>
              </div>
            ) : (
              /* Model Selector */
              onModelChange ? (
                <div className="relative" data-floating-dropdown>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSizeOpen(false);
                      setAudioProviderOpen(false);
                      setModelOpen((prev) => !prev);
                    }}
                    className={cn(
                      "h-9 w-auto px-2.5 text-[13px] font-medium transition-colors gap-2 rounded-xl cursor-pointer flex items-center select-none",
                      modelOpen
                        ? "bg-white/15 text-white"
                        : "text-white/90 hover:text-white hover:bg-white/[0.06]"
                    )}
                  >
                    <BarChart2 size={16} className="text-white/70 shrink-0" />
                    <span className="font-semibold">{displayModelName}</span>
                  </button>

                  {modelOpen && (
                    <div
                      className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[200px] max-h-60 overflow-y-auto rounded-2xl border border-white/10 bg-[#1e1e22] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.7)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {modelList.map((m) => {
                        const isSelected = currentModel === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              onModelChange?.(m.id);
                              setModelOpen(false);
                              mentionAreaRef.current?.focus();
                            }}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer",
                              isSelected
                                ? "bg-white/15 text-white font-medium"
                                : "text-white/70 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span>{m.name}</span>
                              {'badge' in m && m.badge ? (
                                <span className="rounded bg-accent/20 px-1 py-0.5 text-[9px] text-accent">
                                  {m.badge}
                                </span>
                              ) : null}
                            </div>
                            {isSelected ? <Check size={14} className="text-accent shrink-0" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 h-9 px-2.5 text-[13px] font-semibold text-white/90">
                  <BarChart2 size={16} className="text-white/70 shrink-0" />
                  <span>{displayModelName}</span>
                </div>
              )
            )}

            {/* Size / Ratio Selector */}
            {((isVideo && onRatioChange) || (!isVideo && !isAudio && !isNote && onSizeChange)) && (
              <div className="relative" data-floating-dropdown>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModelOpen(false);
                    setAudioProviderOpen(false);
                    setSizeOpen((prev) => !prev);
                  }}
                  className={cn(
                    "h-9 w-auto px-2.5 text-[13px] font-medium transition-colors gap-2 rounded-xl cursor-pointer flex items-center select-none",
                    sizeOpen
                      ? "bg-white/15 text-white"
                      : "text-white/90 hover:text-white hover:bg-white/[0.06]"
                  )}
                >
                  <Scan size={16} className="text-white/70 shrink-0" />
                  <span>{sizeLabel}</span>
                </button>

                {sizeOpen && (
                  <div
                    className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[130px] rounded-2xl border border-white/10 bg-[#1e1e22] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.7)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isVideo
                      ? (['16:9', '9:16', '1:1'] as const).map((r) => {
                          const label = r === '16:9' ? '横屏(16:9)' : r === '9:16' ? '竖屏(9:16)' : '方形(1:1)';
                          const isSelected = ratio === r;
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => {
                                onRatioChange?.(r);
                                setSizeOpen(false);
                                mentionAreaRef.current?.focus();
                              }}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer",
                                isSelected
                                  ? "bg-white/15 text-white font-medium"
                                  : "text-white/70 hover:bg-white/10 hover:text-white"
                              )}
                            >
                              <span>{label}</span>
                              {isSelected ? <Check size={14} className="text-accent shrink-0" /> : null}
                            </button>
                          );
                        })
                      : ([
                          { id: '1024x1024', label: '自适应(4K)' },
                          { id: '1024x1536', label: '竖屏(9:16)' },
                          { id: '1536x1024', label: '横屏(16:9)' },
                        ] as const).map((s) => {
                          const isSelected = size === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                onSizeChange?.(s.id);
                                setSizeOpen(false);
                                mentionAreaRef.current?.focus();
                              }}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer",
                                isSelected
                                  ? "bg-white/15 text-white font-medium"
                                  : "text-white/70 hover:bg-white/10 hover:text-white"
                              )}
                            >
                              <span>{s.label}</span>
                              {isSelected ? <Check size={14} className="text-accent shrink-0" /> : null}
                            </button>
                          );
                        })}
                  </div>
                )}
              </div>
            )}

            {/* Tuning / Advanced Parameters Button */}
            <button
              type="button"
              onClick={() => {
                setModelOpen(false);
                setSizeOpen(false);
                setAudioProviderOpen(false);
                setParamsOpen((prev) => !prev);
              }}
              title="高级参数设置"
              className={cn(
                'h-9 w-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer',
                paramsOpen
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:text-white hover:bg-white/[0.06]',
              )}
            >
              <SlidersHorizontal size={15} />
            </button>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* AI Prompt Refinement Button */}
            {(isImage || isVideo) && (
              <button
                type="button"
                onClick={handleRefinePrompt}
                disabled={refining || !prompt.trim()}
                title={refining ? '正在润色提示词…' : 'AI 快速润色提示词 (基于当前配置模型)'}
                className={cn(
                  'h-9 px-2.5 rounded-xl flex items-center gap-1.5 text-[12px] font-medium transition-all cursor-pointer select-none',
                  refining
                    ? 'bg-[#edd7a3]/15 text-[#edd7a3] cursor-wait'
                    : !prompt.trim()
                      ? 'text-white/25 cursor-not-allowed hover:bg-transparent'
                      : 'text-[#edd7a3] hover:text-[#edd7a3] hover:bg-[#edd7a3]/10 bg-[#edd7a3]/5 border border-[#edd7a3]/20 shadow-xs active:scale-95',
                )}
              >
                {refining ? (
                  <Loader2 size={13} className="animate-spin text-[#edd7a3]" />
                ) : (
                  <Sparkles size={13} className="text-[#edd7a3]" />
                )}
                <span>{refining ? '润色中…' : '润色'}</span>
              </button>
            )}

            <button
              type="button"
              title="语音输入"
              className="h-9 w-9 rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <Mic size={16} />
            </button>

            {/* Variations count for image / duration for video */}
            {!isVideo && !isAudio && !isNote && onVariationsCountChange ? (
              <button
                type="button"
                onClick={cycleVariations}
                title={`变体数量: ${variationsCount}x (点击切换)`}
                className="h-9 px-2.5 rounded-xl flex items-center justify-center text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer select-none"
              >
                {variationsCount}x
              </button>
            ) : isVideo && onDurationChange ? (
              <button
                type="button"
                onClick={() => onDurationChange(duration === '5s' ? '10s' : '5s')}
                title={`视频时长: ${duration} (点击切换)`}
                className="h-9 px-2.5 rounded-xl flex items-center justify-center text-[13px] font-medium text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer select-none"
              >
                {duration}
              </button>
            ) : null}

            {/* Capsule Action Button */}
            <button
              type="button"
              onClick={isNote && onAgentExpand ? onAgentExpand : onRun}
              disabled={running || !canGenerate}
              className={cn(
                'inline-flex items-center gap-2.5 h-10 pl-3.5 pr-1.5 rounded-full transition-all cursor-pointer select-none',
                running || !canGenerate
                  ? 'bg-[#222225] opacity-40 cursor-not-allowed text-white/50 border border-white/[0.04]'
                  : 'bg-[#27272a] hover:bg-[#323238] active:scale-[0.98] text-white border border-white/[0.08] shadow-md hover:shadow-lg',
              )}
              title={
                isNote
                  ? 'AI 扩写剧本与提示词'
                  : isAudio
                    ? '生成音频'
                    : isVideo
                      ? '生成视频'
                      : variationsCount > 1
                        ? `生成 ${variationsCount} 张变体`
                        : '生成图片'
              }
            >
              <div className="flex items-center gap-1.5">
                {isNote ? (
                  <Bot size={15} className="text-white/80 shrink-0" />
                ) : (
                  <Sparkles size={15} className="text-white/80 shrink-0" />
                )}
                <span className="text-[13px] font-semibold text-white/90 tabular-nums">
                  {cost}
                </span>
              </div>
              <div className="w-7 h-7 rounded-full bg-white/[0.12] hover:bg-white/[0.2] flex items-center justify-center text-white transition-colors shrink-0">
                {running ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <ArrowUp size={13} strokeWidth={2.5} />
                )}
              </div>
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
      className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] transition-all hover:border-white/30 cursor-pointer"
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[9px] text-white/50">
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
        className="absolute right-0 top-0 hidden h-3.5 w-3.5 items-center justify-center rounded-bl bg-black/80 text-white/80 hover:text-white group-hover:flex"
      >
        <X size={8} />
      </span>
    </button>
  );
}

export default memo(NodeFloatingPanel);
