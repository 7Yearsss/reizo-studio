import { X } from 'lucide-react';
import type { QueuedTurn } from '../../state/chatStore';

export default function QueuePanel({
  items,
  onRemove,
}: {
  items: QueuedTurn[];
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2 space-y-1">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-2xl border border-line bg-paper-raised px-3 py-2 text-xs text-ink"
        >
          <span className="text-ink-muted">{index === 0 ? '下一条' : `排队 ${index + 1}`}</span>
          <span className="min-w-0 flex-1 truncate">{item.text}</span>
          <button type="button" onClick={() => onRemove(item.id)} className="text-ink-muted hover:text-danger">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
