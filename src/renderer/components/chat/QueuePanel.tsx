import { useState } from 'react';
import { ChevronDown, ChevronRight, ListOrdered, MessageSquarePlus, SendHorizontal, X } from 'lucide-react';
import Tooltip from '../ui/Tooltip';
import type { QueuedTurn } from '../../state/chatStore';

export default function QueuePanel({
  items,
  steers = [],
  onRemove,
  onEdit,
  onSendNow,
}: {
  items: QueuedTurn[];
  /** Steers accepted by the live turn, pending injection at the next step — not editable/removable. */
  steers?: { id: string; text: string }[];
  onRemove: (id: string) => void;
  /** Move the queued text back into the composer for editing. */
  onEdit: (item: QueuedTurn) => void;
  /** Interrupt the live turn and send this queued message immediately. */
  onSendNow: (item: QueuedTurn) => void;
}) {
  const total = items.length + steers.length;
  // DSH-style dock: once there are several parked messages, collapse the list
  // to a single header line so the composer stays compact.
  const collapsible = total > 2;
  const [collapsed, setCollapsed] = useState(collapsible);
  if (total === 0) return null;

  return (
    <div className="mb-2 space-y-1">
      <button
        type="button"
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        className="flex items-center gap-1.5 px-1 text-[11px] text-ink-muted"
      >
        <ListOrdered size={11} />
        <span>
          {items.length > 0 && `排队中 ${items.length} 条 · 上一条回复完自动发送`}
          {items.length > 0 && steers.length > 0 && ' · '}
          {steers.length > 0 && `插话中 ${steers.length} 条`}
        </span>
        {collapsible && (collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />)}
      </button>
      {!collapsed && (
        <>
          {steers.map((steer) => (
            <div
              key={steer.id}
              className="rise-in flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-ink"
            >
              <span className="flex shrink-0 items-center gap-1 text-accent">
                <MessageSquarePlus size={11} />
                插话中
              </span>
              <span className="min-w-0 flex-1 truncate">{steer.text}</span>
              <span className="shrink-0 animate-pulse text-[10px] text-ink-muted">下一步注入</span>
            </div>
          ))}
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
        </>
      )}
    </div>
  );
}
