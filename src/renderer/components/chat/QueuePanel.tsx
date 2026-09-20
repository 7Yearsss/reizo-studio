import { ListOrdered, SendHorizontal, X } from 'lucide-react';
import Tooltip from '../ui/Tooltip';
import type { QueuedTurn } from '../../state/chatStore';

export default function QueuePanel({
  items,
  onRemove,
  onEdit,
  onSendNow,
}: {
  items: QueuedTurn[];
  onRemove: (id: string) => void;
  /** Move the queued text back into the composer for editing. */
  onEdit: (item: QueuedTurn) => void;
  /** Interrupt the live turn and send this queued message immediately. */
  onSendNow: (item: QueuedTurn) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2 space-y-1">
      <div className="flex items-center gap-1.5 px-1 text-[11px] text-ink-muted">
        <ListOrdered size={11} />
        <span>排队中 {items.length} 条 · 上一条回复完自动发送</span>
      </div>
      {items.map((item, index) => (
        <div
          key={item.id}
          className="rise-in flex items-center gap-2 rounded-2xl border border-line bg-paper-raised px-3 py-2 text-xs text-ink"
        >
          <span className="shrink-0 text-ink-muted">{index === 0 ? '下一条' : `排队 ${index + 1}`}</span>
          <Tooltip content="点击取回输入框编辑" side="top" wrapperClassName="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onEdit(item)}
              className="block w-full truncate text-left hover:text-accent transition-colors"
            >
              {item.text}
            </button>
          </Tooltip>
          <Tooltip content="立即发送（打断当前回复）" side="top" wrapperClassName="inline-flex shrink-0">
            <button
              type="button"
              onClick={() => onSendNow(item)}
              className="text-ink-muted hover:text-accent"
            >
              <SendHorizontal size={12} />
            </button>
          </Tooltip>
          <Tooltip content="移出队列" side="top" wrapperClassName="inline-flex shrink-0">
            <button type="button" onClick={() => onRemove(item.id)} className="text-ink-muted hover:text-danger">
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
