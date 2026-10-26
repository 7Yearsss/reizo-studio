import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ChatMessage } from '../../../shared/chat';
import { parseBoundary } from '../../../shared/compactBoundary';
import { cn } from '../../lib/cn';

/** Marks where earlier conversation was summarised for the model; the full text above is still there. */
export default function CompactDivider({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const payload = parseBoundary(message);
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-[11px] text-ink-muted transition-colors hover:text-ink"
      >
        <span className="h-px flex-1 bg-line" />
        <ChevronRight size={12} className={cn('transition-transform duration-150', open && 'rotate-90')} />
        <span>{payload?.source === 'auto' ? '已自动压缩以上对话' : '已压缩以上对话'}（模型只看摘要）</span>
        <span className="h-px flex-1 bg-line" />
      </button>
      {open && payload ? (
        <p className="mx-auto mt-2 max-w-2xl whitespace-pre-wrap rounded-xl bg-paper-inset px-3 py-2 text-xs leading-relaxed text-ink-muted">{payload.summaryText}</p>
      ) : null}
    </div>
  );
}
