import type { TodoItem } from '../../../shared/stream';
import { TodoList } from '../agents/todo-list';

export default function TodoCard({
  items,
  defaultOpen,
  collapseOnComplete,
}: {
  items: TodoItem[];
  defaultOpen?: boolean;
  collapseOnComplete?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <TodoList
      title="计划"
      defaultOpen={defaultOpen}
      collapseOnComplete={collapseOnComplete}
      className="rise-in mb-3 border-line bg-paper-raised"
      items={items.map((item) => ({
        id: item.id,
        title: item.content,
        status: item.status === 'in_progress' ? 'in-progress' : item.status,
      }))}
    />
  );
}
