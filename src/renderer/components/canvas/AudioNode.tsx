import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { Position, type NodeProps, useStore } from '@xyflow/react';
import {
  Download,
  FolderPlus,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Repeat,
  Upload,
  Sparkles,
  Loader2,
  Music,
  RotateCw,
} from 'lucide-react';
import type { CanvasAudioParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as chatStore from '../../state/chatStore';
import { cn } from '../../lib/cn';
import { useProvidersByCategory, loadProviderCatalog } from '../../state/providerCatalogStore';
import FloatingNodeHeader from './FloatingNodeHeader';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import { useHoverIntent } from './NodeActionBar';
import { useIsSoloSelected } from './useSelectionCount';
import MagneticHandle from './MagneticHandle';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { useAssetUrl } from './useAssetUrl';
import NodeFloatingPanel, { type UpstreamSourceItem } from './NodeFloatingPanel';
import { serializeMention } from '../../../shared/resolveMentions';

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Generate a deterministic aesthetic waveform bar profile
const WAVE_BARS = [
  24, 40, 65, 80, 45, 90, 75, 55, 30, 60, 95, 85, 40, 70, 100, 80, 60, 45, 90,
  70, 85, 50, 35, 65, 90, 75, 50, 35, 60, 80, 95, 65, 45, 75, 90, 60, 40, 25,
];

function AudioNode({ id, data, selected }: NodeProps) {
  const {
    sessionId,
    node,
    highlighted,
    agentMark,
    isProposal,
    readiness = [],
    hasUpstreamPrompt = false,
  } = data as CanvasNodeData;

  const params = (node.params as CanvasAudioParams) || { prompt: '' };
  const [prompt, setPrompt] = useState(params.prompt ?? '');
  const [showConfig, setShowConfig] = useState(false);
  const [assetIdx, setAssetIdx] = useState(0);
  const { hovered, hoverProps } = useHoverIntent();
  const solo = useIsSoloSelected(selected);
  const canvasZoom = useStore((s) => s.transform[2]) || 1;
  const headerScale = Math.min(8, Math.max(1, 1 / canvasZoom));
  const expanded = solo || hovered;

  // Multi-select collapses per-node chrome; drop any manually-opened config too.
  useEffect(() => {
    if (!solo) setShowConfig(false);
  }, [solo]);

  const running = node.runState === 'running';
  const assets = node.output?.assets ?? [];
  const current = assets[Math.min(assetIdx, assets.length - 1)];
  const assetUrl = useAssetUrl(current);
  const hasAudio = Boolean(assetUrl);

  // Audio playback state
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoop, setIsLoop] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const audioProviders = useProvidersByCategory('audio');

  useEffect(() => {
    void loadProviderCatalog();
  }, []);

  const activeProviderId =
    (params as any).providerId ||
    audioProviders.find((p) => p.isDefault)?.id ||
    audioProviders[0]?.id;

  const currentProvider =
    audioProviders.find((p) => p.id === activeProviderId) || audioProviders[0];

  const handleProviderSelect = (providerId: string) => {
    const selectedP = audioProviders.find((p) => p.id === providerId);
    if (!selectedP) return;

    const sample = selectedP.sampleParams || {};
    const updatedParams = {
      ...params,
      providerId: selectedP.id,
      model: (sample.model as string) || selectedP.availableModels?.[0]?.id,
      voiceId: (sample.voice_id as string) || (sample.voice as string) || selectedP.voicePresets?.[0]?.id,
      speed: (sample.speed as number) ?? 1.0,
      pitch: (sample.pitch as number) ?? 0,
      format: (sample.format as 'mp3' | 'wav') || 'mp3',
    };
    void canvasStore.updateNodeParams(sessionId, node.id, updatedParams);
  };

  const run = () => {
    commitPrompt();
    void canvasStore.runNode(sessionId, node.id);
  };

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
              ? '参考图'
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
    if (assetIdx >= assets.length) setAssetIdx(0);
  }, [assets.length, assetIdx]);

  // Sync audio pause on unmount or URL change
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [assetUrl]);

  const commitPrompt = () => {
    if (prompt === params.prompt) return;
    void canvasStore.updateNodeParams(sessionId, node.id, { ...params, prompt });
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el || !assetUrl) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      void el.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const toggleMute = () => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleLoop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.loop = !isLoop;
    setIsLoop(!isLoop);
  };

  const seekDelta = (seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + seconds));
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    const wf = waveformRef.current;
    if (!el || !wf || !duration) return;
    const rect = wf.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
      return;
    }
    try {
      await canvasStore.uploadAssetToNode(sessionId, node.id, file);
    } catch {
      /* ignore */
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleUpload(file);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      {...hoverProps}
      className={cn(
        'group relative flex h-full w-full flex-col rounded-2xl p-0 transition-all cursor-default select-none overflow-visible',
        selected
          ? 'border-2 border-[#edd7a3] shadow-[0_0_12px_rgba(237,215,163,0.35)]'
          : 'border border-white/15 hover:border-white/30',
        running && 'canvas-node-running',
        highlighted && 'canvas-node-highlight',
        isProposal && 'border-dashed !border-2 !border-accent shadow-[0_0_15px_rgba(99,102,241,0.35)] animate-pulse-subtle',
      )}
    >
      <AgentMark show={agentMark} />

      {/* Hidden HTML5 audio element */}
      {assetUrl ? (
        <audio
          ref={audioRef}
          src={assetUrl}
          preload="metadata"
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
          onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
          onEnded={() => {
            if (!isLoop) setIsPlaying(false);
          }}
        />
      ) : null}

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
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="audio_out"
        nodeId={node.id}
        kind="audio"
        label="引用该节点生成"
        top="50%"
        nodeHovered={hovered || selected}
      />

      {/* Floating Header Upload Button (pops up on hover or select) */}
      {!hasAudio && (selected || hovered) ? (
        <div
          className="nodrag cursor-default absolute bottom-[calc(100%+8px)] left-1/2 z-30 -translate-x-1/2 animate-in fade-in zoom-in-95 duration-200"
          style={{
            transform: `translateX(-50%) scale(${headerScale}) translateY(-28px)`,
            transformOrigin: 'bottom center',
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="flex items-center gap-1.5 rounded-full bg-[#18181b]/95 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,0.4)] border border-white/20 hover:bg-[#27272a] hover:border-white/35 active:scale-95 transition-all cursor-pointer whitespace-nowrap backdrop-blur-md"
            title="上传本地音频"
          >
            <Upload size={13} className="stroke-[2.2] text-white/90" />
            <span>上传</span>
          </button>
        </div>
      ) : null}

      {/* Floating anti-zoom header outside the card boundary */}
      <FloatingNodeHeader
        sessionId={sessionId}
        nodeId={node.id}
        title={node.title}
        fallback="音频"
        icon={<Volume2 size={13} className="text-amber-400 shrink-0" />}
        selected={selected}
        hovered={hovered}
        running={running}
        status={
          <>
            {!running && readiness.length > 0 ? <MissingInputWarning messages={readiness} /> : null}
            {hasAudio ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px]',
                  isPlaying
                    ? 'bg-accent/15 text-accent font-medium animate-pulse'
                    : 'bg-paper-inset text-ink-muted',
                )}
              >
                {isPlaying ? '播放中' : duration > 0 ? formatTime(duration) : '就绪'}
              </span>
            ) : null}
          </>
        }
      />

      {/* Pure & Clean Empty Audio Placeholder / Dropzone */}
      {!hasAudio ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={handleDrop}
          className={cn(
            'group/placeholder relative flex h-full w-full flex-col items-center justify-center rounded-2xl transition-all select-none',
            isDraggingFile ? 'bg-white/[0.08]' : 'bg-[#18181b]/80',
          )}
          title="支持拖入音频文件或点击上方上传"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = '';
            }}
          />
          {running ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <Loader2 size={26} className="animate-spin text-[#edd7a3]" />
              <span className="text-[11px] font-medium text-white/60">生成音频中…</span>
            </div>
          ) : (
            <Volume2
              size={36}
              strokeWidth={1.3}
              className="text-white/20 group-hover/placeholder:text-white/40 group-hover/placeholder:scale-105 transition-all pointer-events-none"
            />
          )}
        </div>
      ) : null}

      {/* Clean Waveform Player View (when audio exists) */}
      {hasAudio ? (
        <div className="relative min-h-0 h-full w-full flex-1 flex flex-col justify-between rounded-2xl bg-black/40 p-3 select-none overflow-hidden">
          {/* Track title & duration */}
          <div className="flex items-center justify-between text-[10px] text-ink-muted px-0.5">
            <span className="truncate max-w-[65%] font-medium text-ink flex items-center gap-1">
              <Music size={10} className="text-accent shrink-0" />
              {node.title || '音频音轨'}
            </span>
            <span className="font-mono text-[9px] text-ink-muted">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Interactive Waveform Bar Visualizer */}
          <div
            ref={waveformRef}
            onClick={handleWaveformClick}
            className="group/wave relative my-2 flex h-12 w-full items-center justify-between gap-0.5 cursor-pointer rounded-lg bg-black/30 px-2 py-1 transition-colors hover:bg-black/40"
            title="点击任意位置快速跳转播放进度"
          >
            {WAVE_BARS.map((heightPercent, idx) => {
              const barProgress = (idx / WAVE_BARS.length) * 100;
              const isPast = barProgress <= progressPercent;
              return (
                <div key={idx} className="relative flex-1 flex items-center justify-center h-full">
                  <div
                    style={{ height: `${heightPercent}%` }}
                    className={cn(
                      'w-full max-w-[4px] rounded-full transition-all duration-75',
                      isPast
                        ? 'bg-accent shadow-[0_0_6px_rgba(245,158,11,0.5)]'
                        : 'bg-white/20 group-hover/wave:bg-white/30',
                    )}
                  />
                </div>
              );
            })}

            {/* Playhead progress scrubber line */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-accent shadow-md transition-all"
              style={{ left: `${progressPercent}%` }}
            />
          </div>

          {/* Player controls row */}
          <div className="flex items-center justify-between pt-0.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={togglePlay}
                className="nodrag flex size-7 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm hover:opacity-95 active:scale-95 transition-all"
                title={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? (
                  <Pause size={12} className="fill-current" />
                ) : (
                  <Play size={12} className="fill-current translate-x-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => seekDelta(-5)}
                className="nodrag rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
                title="快退 5 秒"
              >
                <RotateCcw size={11} />
              </button>

              <button
                type="button"
                onClick={toggleLoop}
                className={cn(
                  'nodrag rounded p-1 transition-colors',
                  isLoop ? 'bg-accent/15 text-accent' : 'text-ink-muted hover:bg-paper-inset hover:text-ink',
                )}
                title={isLoop ? '循环播放: 开' : '循环播放: 关'}
              >
                <Repeat size={11} />
              </button>

              <button
                type="button"
                onClick={toggleMute}
                className={cn(
                  'nodrag rounded p-1 transition-colors',
                  isMuted ? 'text-danger' : 'text-ink-muted hover:bg-paper-inset hover:text-ink',
                )}
                title={isMuted ? '解除静音' : '静音'}
              >
                {isMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  run();
                }}
                disabled={running}
                className="nodrag rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
                title="按当前配置重新生成音频"
              >
                {running ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
              </button>
              <a
                href={assetUrl}
                download
                onClick={(e) => e.stopPropagation()}
                className="nodrag rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
                title="下载音频"
              >
                <Download size={11} />
              </a>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="nodrag rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
                title="替换当前音频文件"
              >
                <Upload size={11} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* TapNow floating generation panel for Audio (State 1: when empty and selected) */}
      <NodeFloatingPanel
        sessionId={sessionId}
        node={node}
        visible={Boolean((solo || showConfig) && !hasAudio)}
        nodeType="audio"
        prompt={prompt}
        onPromptChange={setPrompt}
        onPromptCommit={commitPrompt}
        candidates={candidates}
        upstreamSources={upstreamSources}
        running={running}
        onRun={run}
        audioProvider={activeProviderId}
        onAudioProviderChange={handleProviderSelect}
        audioProviders={audioProviders.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))}
        audioVoice={(params as any).voiceId}
        onAudioVoiceChange={(vId) => {
          void canvasStore.updateNodeParams(sessionId, node.id, {
            ...params,
            voiceId: vId,
          });
        }}
        audioVoices={currentProvider?.voicePresets}
      />
    </div>
  );
}

export default memo(AudioNode, (prev, next) => {
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
    prevData.readiness === nextData.readiness &&
    prevData.node === nextData.node
  );
});
