import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { DitherField, DitherMark } from '../../agents/image-generation';
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
  const reduce = useReducedMotion() ?? false;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((prev) => prev + 1);
    }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  const messages = mode === 'edit' ? EDIT_MESSAGES : GENERATE_MESSAGES;
  const message = messages[tick % messages.length];

  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl bg-muted text-foreground select-none',
        compact ? 'min-h-[120px]' : 'h-full w-full',
        className,
      )}
    >
      {/* Same dither field the chat image-generation card uses. */}
      <DitherField interactive={false} reduce={reduce} status="generating" />

      {/* Small status line — no progress bar, no timer. */}
      <div className="absolute left-3 bottom-3 z-10 flex items-center gap-2 rounded-full bg-background/75 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm">
        <DitherMark status="generating" reduce={reduce} />
        <span className="truncate transition-all duration-300">{label || message}</span>
      </div>
    </div>
  );
}
