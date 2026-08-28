import { useEffect, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';

/** `Xs` for under a minute, `Xm Ys` above. Floors at 1s so it's never "0s". */
export function formatThinkingDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Collapsible model-reasoning block, shown above the assistant's answer.
 * Mirrors cindy's ThinkingCard: chromeless header row, collapsed by default
 * in every state, a live elapsed counter while streaming, a frozen
 * "已思考 Xs" once done, and a left-railed italic body when expanded.
 */
export default function ThinkingCard({
  content,
  streaming = false,
  startedAt,
  durationMs,
}: {
  content: string;
  streaming?: boolean;
  startedAt?: number;
  durationMs?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!streaming || !startedAt) return;
    setElapsed(Date.now() - startedAt);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [streaming, startedAt]);

  const shownMs = streaming
    ? elapsed
    : (durationMs ?? (startedAt ? Date.now() - startedAt : 0));

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full select-none items-center gap-1.5 py-0.5 text-left text-ink-muted transition-opacity duration-150 hover:opacity-80"
      >
        <Sparkles size={13} className="shrink-0" />
        <span className="text-[13px]">{streaming ? '思考中' : `已思考 ${formatThinkingDuration(shownMs)}`}</span>
        {streaming && (
          <span className="flex items-center gap-[3px]">
            <Dot delay={0} />
            <Dot delay={150} />
            <Dot delay={300} />
          </span>
        )}
        {streaming && startedAt && (
          <span className="font-mono text-[11px] tabular-nums">{formatThinkingDuration(shownMs)}</span>
        )}
        <ChevronRight
          size={13}
          className={cn('ml-auto shrink-0 transition-transform duration-150', expanded && 'rotate-90')}
        />
      </button>

      {expanded && (
        <div className="mt-1 border-l-2 border-line py-1 pl-3">
          {content ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted italic select-text">
              {content}
            </p>
          ) : (
            <p className="text-[13px] text-ink-muted/60 italic">（暂无思考内容）</p>
          )}
        </div>
      )}
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="size-1 animate-pulse rounded-full bg-ink-muted"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
