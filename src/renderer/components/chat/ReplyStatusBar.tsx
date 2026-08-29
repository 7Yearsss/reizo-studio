import { BrainCircuit, Clock3, LoaderCircle, MessageCircle, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TodoItem } from '../../../shared/stream';
import type { ReplyPhase } from '../../../shared/stream';
import type { ChatInteraction } from '../../state/chatStore';

export type { ReplyPhase } from '../../../shared/stream';

const PHASE_LABEL: Record<ReplyPhase, string> = {
  preparing: '准备中',
  thinking: '正在思考',
  tools: '正在使用工具',
  replying: '正在回复',
  waiting: '等待你的回应',
};

export default function ReplyStatusBar({
  phase,
  startedAt,
  toolCount,
  todos,
  interaction,
}: {
  phase: ReplyPhase;
  startedAt?: number;
  toolCount: number;
  todos: TodoItem[];
  interaction: ChatInteraction | null;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = startedAt ?? Date.now();
    const update = () => setElapsed(Math.max(0, Date.now() - start));
    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [phase, startedAt]);

  const done = todos.filter((item) => item.status === 'completed').length;
  const Icon = phase === 'thinking'
    ? BrainCircuit
    : phase === 'tools'
      ? Wrench
      : phase === 'replying'
        ? MessageCircle
        : phase === 'waiting'
          ? Clock3
          : LoaderCircle;
  const suffix = phase === 'tools' && toolCount > 0
    ? ` · ${toolCount} 个`
    : todos.length > 0
      ? ` · 计划 ${done}/${todos.length}`
      : '';

  return (
    <div className="mb-2 flex min-h-7 items-center gap-2 px-1 text-[11px] text-ink-muted" role="status" aria-live="polite">
      <Icon className={phase === 'preparing' || phase === 'thinking' || phase === 'tools' || phase === 'replying' ? 'h-3.5 w-3.5 animate-pulse' : 'h-3.5 w-3.5'} />
      <span>{interaction ? PHASE_LABEL.waiting : PHASE_LABEL[phase]}{suffix}</span>
      <span className="ml-auto inline-flex items-center gap-1 font-mono tabular-nums text-[10px] text-ink-muted/80">
        <Clock3 className="h-3 w-3" />
        {Math.max(1, Math.round(elapsed / 1000))}s
      </span>
    </div>
  );
}
