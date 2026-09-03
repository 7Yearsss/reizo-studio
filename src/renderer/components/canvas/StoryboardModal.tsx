import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, X, Film, Download, Copy, Check } from 'lucide-react';
import type { CanvasNode, CanvasVideoParams } from '../../../shared/canvas';
import { canvasAssetUrl } from '../../api';
import { cn } from '../../lib/cn';

interface StoryboardModalProps {
  nodes: CanvasNode[];
  onClose: () => void;
}

export default function StoryboardModal({ nodes, onClose }: StoryboardModalProps) {
  // Filter only video nodes with assets
  const videoClips = nodes.filter((n) => {
    const assets = (n.output?.assets as string[]) || [];
    return n.type === 'video' && assets.length > 0;
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [copied, setCopied] = useState(false);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement>(null);

  // Preload asset URLs
  useEffect(() => {
    let active = true;
    for (const node of videoClips) {
      const rel = (node.output?.assets as string[])?.[0];
      if (rel && !videoUrls[node.id]) {
        void canvasAssetUrl(rel).then((u) => {
          if (active && u) {
            setVideoUrls((prev) => ({ ...prev, [node.id]: u }));
          }
        });
      }
    }
    return () => {
      active = false;
    };
  }, [videoClips, videoUrls]);

  const currentClip = videoClips[currentIndex];
  const currentUrl = currentClip ? videoUrls[currentClip.id] : null;

  useEffect(() => {
    if (videoRef.current && currentUrl) {
      videoRef.current.currentTime = 0;
      if (isPlaying) {
        void videoRef.current.play().catch(() => setIsPlaying(false));
      }
    }
  }, [currentIndex, currentUrl, isPlaying]);

  const handleEnded = () => {
    if (currentIndex < videoClips.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      // Reached the end of storyboard: loop back to first clip or pause
      setCurrentIndex(0);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      void videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const copyScriptOverview = () => {
    const text = videoClips
      .map((c, i) => {
        const p = (c.params as unknown as CanvasVideoParams) || ({} as Partial<CanvasVideoParams>);
        return `[镜头 ${i + 1}] ${c.title || '分镜'}\n提示词: ${p.prompt || '无'}\n运镜: ${p.cameraMotion || '默认'} · 时长: ${p.duration || '5s'}`;
      })
      .join('\n\n');
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (videoClips.length === 0) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-6 backdrop-blur-xl">
        <div className="flex max-w-sm flex-col items-center rounded-2xl border border-line bg-paper-raised p-6 text-center shadow-2xl">
          <Film size={32} className="text-ink-muted mb-3" />
          <h3 className="text-sm font-semibold text-ink">尚无已渲染完成的视频分镜</h3>
          <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
            请先在画布上运行视频卡片生成完成至少 1 个分镜视频后再进入串联审片。
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-xl bg-ink px-4 py-1.5 text-xs font-medium text-paper-raised"
          >
            返回画布
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/90 text-white backdrop-blur-2xl select-none animate-in fade-in-0 duration-200">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-3.5 bg-black/40">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/20 text-accent">
            <Film size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/95">分镜短片连续审片室</h2>
            <p className="text-[11px] text-white/50">
              共 {videoClips.length} 个镜头分镜 · 自动无缝顺序连播
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyScriptOverview}
            className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            {copied ? '已复制脚本' : '导出分镜脚本'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            title="关闭审片 (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Theatre Viewport */}
      <div className="relative flex flex-1 items-center justify-center p-6 min-h-0">
        <div className="relative flex h-full max-w-5xl w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/60 shadow-2xl">
          {currentUrl ? (
            <video
              ref={videoRef}
              src={currentUrl}
              onEnded={handleEnded}
              className="h-full w-full object-contain"
              autoPlay
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-white/40">
              <Film size={36} className="animate-pulse" />
              <span className="text-xs">加载镜头画面中…</span>
            </div>
          )}

          {/* Current Clip Badge Overlay */}
          <div className="absolute top-4 left-4 flex items-center gap-2 rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white/90 backdrop-blur-md">
            <span className="flex size-2 rounded-full bg-accent animate-pulse" />
            <span className="font-semibold">镜头 {currentIndex + 1} / {videoClips.length}</span>
            <span className="text-white/40">·</span>
            <span className="truncate max-w-xs text-white/80">{currentClip?.title || '未命名分镜'}</span>
          </div>

          {/* Playback Controls Float */}
          <div className="absolute bottom-4 flex items-center gap-3 rounded-2xl border border-white/15 bg-black/70 px-4 py-2 text-white backdrop-blur-xl shadow-2xl">
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              className="rounded-lg p-1.5 text-white/70 hover:bg-white/15 hover:text-white disabled:opacity-30 transition-colors"
              title="上一个分镜"
            >
              <SkipBack size={16} />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="flex size-9 items-center justify-center rounded-xl bg-white text-black hover:scale-105 active:scale-95 transition-all shadow-md"
              title={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5 fill-black" />}
            </button>
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => Math.min(videoClips.length - 1, i + 1))}
              disabled={currentIndex === videoClips.length - 1}
              className="rounded-lg p-1.5 text-white/70 hover:bg-white/15 hover:text-white disabled:opacity-30 transition-colors"
              title="下一个分镜"
            >
              <SkipForward size={16} />
            </button>
            <div className="h-4 w-px bg-white/20" />
            <button
              type="button"
              onClick={() => {
                setCurrentIndex(0);
                if (videoRef.current) {
                  videoRef.current.currentTime = 0;
                  void videoRef.current.play();
                  setIsPlaying(true);
                }
              }}
              className="flex items-center gap-1 text-xs text-white/70 hover:text-white px-1.5 py-1 rounded-lg hover:bg-white/10 transition-colors"
              title="从头完整播放短片"
            >
              <RotateCcw size={13} />
              重播全片
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Timeline Strip */}
      <div className="border-t border-white/10 bg-black/60 p-4">
        <div className="mx-auto max-w-5xl">
          <div className="mb-2 flex items-center justify-between text-xs text-white/60">
            <span className="font-medium">时间线轨道 (点击切换镜头)</span>
            <span>总计 {videoClips.length} 个镜头分镜</span>
          </div>

          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
            {videoClips.map((clip, idx) => {
              const url = videoUrls[clip.id];
              const p = (clip.params as unknown as CanvasVideoParams) || ({} as Partial<CanvasVideoParams>);
              const isCurrent = idx === currentIndex;
              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={cn(
                    'group relative flex w-40 shrink-0 flex-col overflow-hidden rounded-xl border p-1 text-left transition-all',
                    isCurrent
                      ? 'border-accent bg-accent/10 ring-2 ring-accent/60 shadow-lg scale-102'
                      : 'border-white/15 bg-white/5 hover:border-white/30 hover:bg-white/10 opacity-70 hover:opacity-100',
                  )}
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/60">
                    {url ? (
                      <video src={url} className="h-full w-full object-cover" muted />
                    ) : (
                      <div className="flex h-full items-center justify-center text-white/30">
                        <Film size={18} />
                      </div>
                    )}
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.2 text-[9px] font-mono text-white/90">
                      {p.duration || '5s'}
                    </span>
                    {isCurrent ? (
                      <span className="absolute top-1 left-1 flex size-2 rounded-full bg-accent animate-ping" />
                    ) : null}
                  </div>
                  <div className="mt-1.5 px-1 pb-0.5">
                    <div className="flex items-center justify-between gap-1 text-[11px]">
                      <span className="font-semibold text-white/90 truncate">镜头 {idx + 1}</span>
                      <span className="text-[9px] text-white/40">{p.cameraMotion || '默认'}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[10px] text-white/50">
                      {clip.title || p.prompt || '分镜镜头'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
