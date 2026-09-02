import { Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TodoItem } from '../../../shared/stream';
import type { ReplyPhase } from '../../../shared/stream';
import type { ChatInteraction } from '../../state/chatStore';
import { formatTurnElapsed, liveReplyPhase, liveReplySilence, liveReplyWaitLabel } from '../../state/liveReply';
import { ThinkingShimmer } from '../agents/loading-states/thinking-shimmer';

export type { ReplyPhase } from '../../../shared/stream';

const PHASE_LABEL: Record<ReplyPhase, string> = {
  preparing: '准备中',
  thinking: '正在思考',
  tools: '正在使用工具',
  replying: '正在回复',
  waiting: '等待你的回应',
};

export default function ReplyStatusBar({
  startedAt,
  toolCount,
  todos,
  interaction,
  interruptRequested = false,
  recovering = false,
  lastTextAt,
  lastProgressAt,
}: {
  startedAt?: number;
  toolCount: number;
  todos: TodoItem[];
  interaction: ChatInteraction | null;
  interruptRequested?: boolean;
  recovering?: boolean;
  lastTextAt?: number;
  lastProgressAt?: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const start = startedAt ?? now;
  const elapsed = Math.max(0, now - start);
  const phase = liveReplyPhase({
    sending: true,
    waitingOnUser: Boolean(interaction),
    activeToolCount: toolCount,
    lastTextAt,
    now,
  }) ?? 'thinking';
  const silence = liveReplySilence({ lastProgressAt, now });
  const done = todos.filter((item) => item.status === 'completed').length;
  const suffix = phase === 'tools' && toolCount > 0
    ? ` · ${toolCount} 个`
    : todos.length > 0
      ? ` · 计划 ${done}/${todos.length}`
      : '';
  const waitLabel = liveReplyWaitLabel({
    silence,
    waitedMs: lastProgressAt ? now - lastProgressAt : elapsed,
  });
  // The transcript already shows 正在思考 / 正在使用工具. Only keep copy here
  // when it adds information the work card does not: interrupt, recovery,
  // waiting on the user, or a quiet/stale upstream.
  const label = interruptRequested
    ? '正在停止'
    : recovering
      ? '回复连接中断，正在恢复…'
      : interaction
        ? PHASE_LABEL.waiting
        : waitLabel;
  const shimmer = Boolean(label) && !interruptRequested && !recovering && !interaction && silence !== 'stale';

  return (
    <div className="flex min-h-6 min-w-0 items-center gap-2 text-[11px] text-ink-muted" role="status" aria-live="polite">
      {label ? (
        shimmer ? (
          <ThinkingShimmer className="min-w-0 truncate text-[11px]">{label}{suffix}</ThinkingShimmer>
        ) : (
          <span className="min-w-0 truncate">{label}{suffix}</span>
        )
      ) : (
        <span className="min-w-0" />
      )}
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono tabular-nums text-[10px] text-ink-muted/80">
        <Clock3 className="h-3 w-3" />
        {formatTurnElapsed(elapsed)}
      </span>
    </div>
  );
}
