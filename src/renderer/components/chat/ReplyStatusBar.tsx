import { useEffect, useState } from 'react';
import { RotateCcw, Square } from 'lucide-react';
import type { TodoItem } from '../../../shared/stream';
import type { ReplyPhase } from '../../../shared/stream';
import type { ChatInteraction } from '../../state/chatStore';
import { liveReplyPhase, liveReplySilence, liveReplyWaitLabel } from '../../state/liveReply';
import { AgentProgress } from '../agents/loading-states/agent-progress';

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
  onStop,
  onRetry,
  skillName,
}: {
  startedAt?: number;
  toolCount: number;
  todos: TodoItem[];
  interaction: ChatInteraction | null;
  interruptRequested?: boolean;
  recovering?: boolean;
  lastTextAt?: number;
  lastProgressAt?: number;
  /** When set, shows a small stop button (used while the composer is in send mode). */
  onStop?: () => void;
  /** Shown once the upstream has been silent past the stale threshold. */
  onRetry?: () => void;
  /** Name of the pinned skill this turn is running under. */
  skillName?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const start = startedAt ?? now;
  const elapsed = Math.max(0, now - start);
  const phase =
    liveReplyPhase({
      sending: true,
      waitingOnUser: Boolean(interaction),
      activeToolCount: toolCount,
      lastTextAt,
      now,
    }) ?? 'thinking';
  const silence = liveReplySilence({ lastProgressAt, now });
  const done = todos.filter((item) => item.status === 'completed').length;
  const suffix =
    phase === 'tools' && toolCount > 0
      ? ` · ${toolCount} 个工具`
      : todos.length > 0
        ? ` · 计划 ${done}/${todos.length}`
        : '';
  const waitLabel = liveReplyWaitLabel({
    silence,
    waitedMs: lastProgressAt ? now - lastProgressAt : elapsed,
  });

  const baseLabel = interruptRequested
    ? '正在停止'
    : recovering
      ? '连接中断，正在恢复…'
      : interaction
        ? PHASE_LABEL.waiting
        : waitLabel || PHASE_LABEL[phase] || '处理中';

  const fullLabel = `${skillName ? `技能 · ${skillName} · ` : ''}${baseLabel}${suffix}`;

  return (
    <div className="flex min-h-6 min-w-0 items-center justify-between py-1" role="status" aria-live="polite">
      <AgentProgress
        label={fullLabel}
        elapsedSeconds={elapsed / 1000}
        className="gap-2 text-[12px] text-ink-muted"
      />
      <span className="flex shrink-0 items-center gap-1.5">
        {onRetry && silence === 'stale' && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink transition-colors hover:bg-paper-inset"
          >
            <RotateCcw size={10} />
            重试
          </button>
        )}
        {onStop && (
          <button
            type="button"
            aria-label="停止"
            title="停止当前回合"
            onClick={onStop}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-line text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink"
          >
            <Square size={9} className="fill-current" />
          </button>
        )}
      </span>
    </div>
  );
}
