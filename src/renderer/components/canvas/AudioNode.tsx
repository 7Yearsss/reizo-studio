import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
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
} from 'lucide-react';
import type { CanvasAudioParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { cn } from '../../lib/cn';
import FloatingNodeHeader from './FloatingNodeHeader';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import MentionTextArea from './MentionTextArea';
import { useHoverIntent } from './NodeActionBar';
import MagneticHandle from './MagneticHandle';
import AgentMark from './AgentMark';
import MissingInputWarning from './MissingInputWarning';
import { useAssetUrl } from './useAssetUrl';

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
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const { hovered, hoverProps } = useHoverIntent();
  const expanded = selected || hovered;

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

  const candidates = useMemo(() => {
    if (!expanded) return [];
    const snapshot = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
    return snapshot.filter((n) => n.id !== node.id && n.type !== 'anchor');
  }, [expanded, sessionId, node.id]);

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
        'relative flex h-full w-full flex-col rounded-xl border bg-paper-raised p-2.5 text-xs shadow-sm transition-shadow',
        selected ? 'border-accent ring-1 ring-accent/20' : 'border-line',
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

      <NodeResizer
        minWidth={280}
        minHeight={170}
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
        id="audio_out"
        nodeId={node.id}
        kind="audio"
        label="引用该节点生成"
        top="50%"
      />

      {/* Floating anti-zoom header outside the card boundary (TapNow design) */}
      <FloatingNodeHeader
        sessionId={sessionId}
        nodeId={node.id}
        title={node.title}
        fallback="音频播放器"
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

      {/* ComfyUI / Runway Style Mini Audio Player */}
      {hasAudio && !showConfig ? (
        <div className="relative min-h-0 flex-1 flex flex-col justify-between rounded-lg border border-line bg-black/35 p-2.5 backdrop-blur-xs select-none">
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

          {/* Interactive Waveform Bar Visualizer (Click to scrub) */}
          <div
            ref={waveformRef}
            onClick={handleWaveformClick}
            className="group/wave relative my-2 flex h-12 w-full items-center justify-between gap-0.5 cursor-pointer rounded-md bg-black/30 px-2 py-1 transition-colors hover:bg-black/40"
            title="点击任意位置快速跳转播放进度"
          >
            {WAVE_BARS.map((heightPercent, idx) => {
              const barProgress = (idx / WAVE_BARS.length) * 100;
              const isPast = barProgress <= progressPercent;
              return (
                <div
                  key={idx}
                  className="relative flex-1 flex items-center justify-center h-full"
                >
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
              {/* Play / Pause button */}
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

              {/* Seek -5s */}
              <button
                type="button"
                onClick={() => seekDelta(-5)}
                className="nodrag rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
                title="快退 5 秒"
              >
                <RotateCcw size={11} />
              </button>

              {/* Loop toggle */}
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

              {/* Mute toggle */}
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

            {/* Right action icons */}
            <div className="flex items-center gap-1">
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

      {/* Empty State / Dropzone (when no audio yet and config is closed) */}
      {!hasAudio && !showConfig ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={handleDrop}
          className={cn(
            'group/placeholder relative flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center transition-all select-none',
            isDraggingFile
              ? 'border-accent bg-accent/10 scale-[0.99]'
              : 'border-line hover:border-accent/60 bg-black/20 hover:bg-black/30',
          )}
          title="可拖拽移动节点，支持拖入音频文件或配置提示词"
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
          <div className="rounded-full bg-paper-inset/70 p-3 mb-2 text-ink-muted group-hover/placeholder:text-accent group-hover/placeholder:bg-accent/15 group-hover/placeholder:scale-110 transition-all shadow-xs pointer-events-none">
            <Volume2 size={22} />
          </div>
          <span className="text-xs font-medium text-ink pointer-events-none">待配置音频节点</span>
          <p className="mt-1 text-[10px] text-ink-muted/80 pointer-events-none">支持 MP3, WAV, M4A, OGG 音乐与音效</p>
          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowConfig(true);
                canvasStore.setSelection(sessionId, [node.id]);
              }}
              className="nodrag rounded-md bg-paper-raised border border-line px-2.5 py-1 text-[10px] text-ink-muted hover:text-ink hover:border-accent transition-colors"
            >
              配置提示词 ⚙️
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="nodrag rounded-md bg-paper-raised border border-line px-2.5 py-1 text-[10px] text-ink-muted hover:text-ink hover:border-accent transition-colors flex items-center gap-1"
              title="上传本地音频文件"
            >
              <Upload size={10} />
              上传音频
            </button>
          </div>
        </div>
      ) : null}

      {/* Config / Prompt Input Area (when explicitly opened via Sliders) */}
      {showConfig ? (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="mt-1">
            <MentionTextArea
              value={prompt}
              onChange={setPrompt}
              onCommit={commitPrompt}
              candidates={candidates}
              placeholder="描述所需音效风格、配乐情绪或旁白台词（输入 @ 可引用画布节点）…"
            />
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-1.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent font-medium">
                🎵 音频端口就绪
              </span>
            </div>

            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="nodrag inline-flex items-center gap-1 rounded-lg border border-line/70 px-2.5 py-1 text-[10px] text-ink hover:bg-paper-inset transition-colors"
              >
                <Upload size={10} />
                上传音频
              </button>
              <button
                type="button"
                onClick={() => setShowConfig(false)}
                className="nodrag rounded-lg bg-accent text-accent-ink px-3 py-1 text-[10px] font-medium shadow-xs hover:opacity-90 active:scale-95 transition-all"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
