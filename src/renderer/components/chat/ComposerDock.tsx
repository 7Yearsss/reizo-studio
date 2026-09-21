import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ListTodo, Loader2 } from 'lucide-react';
import type { TodoItem } from '../../../shared/stream';
import { cn } from '../../lib/cn';
import TodoCard from './TodoCard';

/**
 * Plan dock: a single pill pinned to the right edge above the composer. Click
 * it once and the full plan card pops up in place (absolute, anchored to the
 * pill) — it never takes a row of layout height, so the message stream keeps
 * its space. Click the pill or anywhere outside to dismiss.
 */
export default function ComposerDock({ todos }: { todos: TodoItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  const running = todos.some((t) => t.status === 'in_progress');

  return (
    <div ref={rootRef} className="pointer-events-auto absolute bottom-full right-0 mb-1.5">
      {open && (
        <div className="absolute bottom-full right-0 mb-1.5 w-80 max-w-[80vw]">
          <TodoCard items={todos} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'ml-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur-sm transition-colors',
          open
            ? 'border-accent/50 bg-accent/10 text-ink'
            : 'border-line bg-paper-raised/90 text-ink-muted hover:text-ink',
        )}
      >
        {running ? (
          <Loader2 size={11} className="animate-spin text-accent" />
        ) : (
          <ListTodo size={11} className={done === todos.length ? 'text-green-500' : 'text-accent'} />
        )}
        计划 {done}/{todos.length}
        <ChevronUp size={11} className={cn('transition-transform', open ? '' : 'rotate-180')} />
      </button>
    </div>
  );
}
