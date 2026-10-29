import { useEffect, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ReasoningText } from '../agents/loading-states/reasoning-text';
import { ThinkingOrb } from './ThinkingOrb';
import { CountingNumber } from './CountingNumber';
import { lastCompleteSentence } from '../../../shared/thinkingPreview';
import { useMinimumDisplayValue } from '../../lib/useMinimumDisplayValue';

/** `Xs` for under a minute, `Xm Ys` above. Floors at 1s so it's never "0s". */
export function formatThinkingDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

const THINKING_PHRASES = [
  '正在推理分析',
  '正在检索上下文',
  '连接逻辑与约束',
  '推导最佳方案',
  '组织回复语言',
];

/**
 * Collapsible model-reasoning block with beUI ReasoningText,
 * organic ThinkingOrb 2D canvas texture, and fluid CountingNumber.
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
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [streaming, startedAt]);

  const shownMs = streaming ? elapsed : durationMs ?? (startedAt ? Date.now() - startedAt : 0);
  const preview = useMinimumDisplayValue(streaming ? lastCompleteSentence(content) : '', 1000);

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full select-none items-center gap-2 py-1 text-left text-ink-muted transition-opacity duration-150 hover:opacity-80"
      >
        {streaming ? (
          <ThinkingOrb size={14} className="shrink-0" />
        ) : (
          <Sparkles size={13} className="shrink-0 text-accent" />
        )}
        {streaming ? (
          <div className="flex items-center gap-2">
            {preview ? (
              <span className="min-w-0 max-w-[32rem] truncate text-[12px] text-ink" title={preview}>{preview}</span>
            ) : (
              <ReasoningText
                phrases={THINKING_PHRASES}
                variant="swap"
                interval={2600}
                className="text-[12px] text-ink"
              />
            )}
            {startedAt && (
              <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                <CountingNumber
                  value={Math.max(1, Math.round(shownMs / 1000))}
                  render={(sec) => {
                    if (sec < 60) return `${sec}s`;
                    const m = Math.floor(sec / 60);
                    const s = sec % 60;
                    return s === 0 ? `${m}m` : `${m}m ${s}s`;
                  }}
                />
              </span>
            )}
          </div>
        ) : (
          <span className="text-[12px]">已思考 {formatThinkingDuration(shownMs)}</span>
        )}
        <ChevronRight
          size={13}
          className={cn('ml-auto shrink-0 transition-transform duration-150', expanded && 'rotate-90')}
        />
      </button>

      {expanded && (
        <div className="mt-1.5 border-l-2 border-line/70 py-1 pl-3 transition-all">
          {content ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted/90 italic select-text font-serif">
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
