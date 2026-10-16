import { Mic } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Tooltip } from '../ui/Tooltip';

export default function VoiceInputButton({ className }: { className?: string }) {
  return (
    <Tooltip content="语音输入暂未启用" side="top" wrapperClassName="inline-flex shrink-0">
      <button
        type="button"
        aria-label="语音输入（暂未启用）"
        aria-disabled="true"
        className={cn(
          'flex size-9 shrink-0 cursor-default items-center justify-center rounded-full bg-paper text-ink-muted transition-colors hover:bg-paper-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          className,
        )}
      >
        <Mic size={16} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
