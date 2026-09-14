import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../../lib/cn';

const GENERATE_MESSAGES = [
  '正在解析提示词…',
  '构思主体与画幅构图…',
  '计算色彩与光影氛围…',
  '正在细化边缘与材质…',
  '正在完善高光与细节…',
  '马上就好，正在成图…',
];

const EDIT_MESSAGES = [
  '正在解析选区与编辑指令…',
  '重绘局部纹理与细节…',
  '融合过渡边缘与环境光…',
  '正在整理导出高清结果…',
];

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export interface ImageGenerationPendingProps {
  className?: string;
  label?: string;
  mode?: 'generate' | 'edit';
  compact?: boolean;
}

export default function ImageGenerationPending({
  className,
  label,
  mode = 'generate',
  compact = false,
}: ImageGenerationPendingProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const messages = mode === 'edit' ? EDIT_MESSAGES : GENERATE_MESSAGES;
  const messageIndex = Math.floor(tick / 2.5) % messages.length;
  // Exponential decay approaching 98% smoothly
  const progress = Math.min(98, 10 + (1 - Math.exp(-tick / 24)) * 88);

  return (
    <div
      className={cn(
        'relative flex flex-col justify-between overflow-hidden rounded-2xl bg-[#141416]/90 p-5 text-white/90 select-none border border-white/5',
        compact ? 'min-h-[120px]' : 'h-full w-full',
        className,
      )}
    >
      {/* Subtle radial dot backdrop pattern with vignette */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(237,215,163,0.2) 1.2px, transparent 1.4px)',
          backgroundSize: '18px 18px',
          maskImage: 'radial-gradient(ellipse at 50% 50%, black 20%, transparent 80%)',
        }}
      />

      {/* Top Status header with spinner */}
      <div className="relative z-10 flex items-center gap-2.5 text-xs font-medium tracking-wide text-white/80">
        <Loader2 size={16} className="animate-spin text-[#edd7a3] shrink-0" />
        <span className="truncate transition-all duration-300">
          {label || messages[messageIndex]}
        </span>
      </div>

      {/* Bottom Progress Bar + Timer */}
      <div className="relative z-10 mt-auto pt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-mono text-white/45">
          <span>{formatDuration(tick)}</span>
          <span className="font-semibold text-white/70">{Math.floor(progress)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#edd7a3]/70 to-[#edd7a3] transition-all duration-700 ease-out shadow-[0_0_8px_rgba(237,215,163,0.35)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
