import { useEffect, useState } from 'react';
import * as api from '../../api';
import { cn } from '../../lib/cn';

const SIZE = 18;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How full the model's context is. Quiet until it matters (60%+): then a small ring that turns warmer as
 * the conversation approaches the point where older turns get summarised. Hover for the numbers.
 */
export default function ContextRing({ sessionId, sending }: { sessionId?: string; sending?: boolean }) {
  const [usage, setUsage] = useState<api.ContextUsage | null>(null);
  const [nonce, setNonce] = useState(0);
  // A compaction just changed what the next request carries.
  useEffect(() => {
    const refresh = () => setNonce((n) => n + 1);
    window.addEventListener('reizo:context-changed', refresh);
    return () => window.removeEventListener('reizo:context-changed', refresh);
  }, []);

  // Refresh when the session changes and each time a reply finishes (the conversation just grew).
  useEffect(() => {
    if (!sessionId || sending) return;
    let cancelled = false;
    void api.getContextUsage(sessionId).then((u) => { if (!cancelled) setUsage(u); }, (): void => undefined);
    return () => { cancelled = true; };
  }, [sessionId, sending, nonce]);

  if (!usage || usage.level === 'ok') return null;
  const ratio = Math.min(usage.ratio, 1);
  const tone = usage.level === 'warn' ? 'text-[var(--peach-ink,#b45309)]' : 'text-danger';
  const percent = Math.round(ratio * 100);
  const hint = usage.level === 'warn'
    ? '对话较长，快到上限时较早的内容会自动压缩成摘要。也可以输入 /compact 现在压缩。'
    : '对话已接近上限，发送下一条前会自动压缩较早的内容。也可以输入 /compact 现在压缩。';
  return (
    <span
      role="img"
      aria-label={`上下文已用约 ${percent}%`}
      title={`上下文约 ${percent}%（${usage.usedTokens.toLocaleString()} / ${usage.windowTokens.toLocaleString()} tokens，估算）\n${hint}`}
      className={cn('inline-flex size-6 shrink-0 items-center justify-center', tone, usage.level === 'urgent' && 'animate-pulse motion-reduce:animate-none')}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
        />
      </svg>
    </span>
  );
}
