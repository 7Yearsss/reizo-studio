import { useState } from 'react';
import { ChevronUp, ListTodo, Loader2, Sparkles } from 'lucide-react';
import type { TodoItem } from '../../../shared/stream';
import { cn } from '../../lib/cn';
import TodoCard from './TodoCard';
import NextStepStrip, { useNextStepActions } from './NextStepStrip';

/**
 * The docked chrome above the composer (plan card, next-step suggestions) as a
 * single pill row — stacked full cards pushed the whole overlay up and covered
 * the message stream. Pills stay one line tall; clicking expands that card
 * inline below the row.
 */
export default function ComposerDock({
  sessionId,
  todos,
  showNext,
  onPick,
}: {
  sessionId: string;
  todos: TodoItem[];
  showNext: boolean;
  onPick: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState<'plan' | 'next' | null>(null);
  const actions = useNextStepActions(sessionId);

  const done = todos.filter((t) => t.status === 'completed').length;
  const running = todos.some((t) => t.status === 'in_progress');
  const hasPlan = todos.length > 0;
  const hasNext = showNext && actions.length > 0;
  if (!hasPlan && !hasNext) return null;

  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5">
        {hasPlan && (
          <button
            type="button"
            onClick={() => setExpanded((e) => (e === 'plan' ? null : 'plan'))}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              expanded === 'plan'
                ? 'border-accent/50 bg-accent/10 text-ink'
                : 'border-line bg-paper-raised text-ink-muted hover:text-ink',
            )}
          >
            {running ? (
              <Loader2 size={11} className="animate-spin text-accent" />
            ) : (
              <ListTodo size={11} className={done === todos.length ? 'text-green-500' : 'text-accent'} />
            )}
            计划 {done}/{todos.length}
            <ChevronUp size={11} className={cn('transition-transform', expanded === 'plan' ? '' : 'rotate-180')} />
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={() => setExpanded((e) => (e === 'next' ? null : 'next'))}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              expanded === 'next'
                ? 'border-accent/50 bg-accent/10 text-ink'
                : 'border-line bg-paper-raised text-ink-muted hover:text-ink',
            )}
          >
            <Sparkles size={11} className="text-accent" />
            下一步建议
            <ChevronUp size={11} className={cn('transition-transform', expanded === 'next' ? '' : 'rotate-180')} />
          </button>
        )}
      </div>
      {expanded === 'plan' && hasPlan && <div className="mt-1.5"><TodoCard items={todos} /></div>}
      {expanded === 'next' && hasNext && <div className="mt-1.5"><NextStepStrip sessionId={sessionId} onPick={onPick} /></div>}
    </div>
  );
}
