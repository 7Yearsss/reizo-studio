import { Circle, CircleCheck, CircleDot } from 'lucide-react';
import type { TodoItem } from '../../../shared/stream';

export default function TodoCard({ items }: { items: TodoItem[] }) {
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === 'completed').length;

  return (
    <div className="rise-in mx-auto mb-3 max-w-3xl rounded-2xl border border-line bg-paper-raised px-4 py-3">
      <p className="mb-2 text-xs text-ink-muted">
        计划 {done} / {items.length}
      </p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm text-ink">
            {item.status === 'completed' ? (
              <CircleCheck size={14} className="text-success" />
            ) : item.status === 'in_progress' ? (
              <CircleDot size={14} className="text-accent" />
            ) : (
              <Circle size={14} className="text-ink-muted" />
            )}
            <span className={item.status === 'completed' ? 'text-ink-muted line-through' : ''}>{item.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
