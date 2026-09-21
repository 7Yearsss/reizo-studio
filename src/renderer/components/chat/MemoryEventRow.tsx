import { useState } from 'react';
import { BookOpen, Brain, ChevronRight, Trash2, Undo2 } from 'lucide-react';
import type { MemoryEventRecord } from '../../../shared/stream';
import { cn } from '../../lib/cn';
import { forgetMemoryItem } from '../../state/chatStore';

const TYPE_LABEL: Record<string, string> = {
  user: '偏好',
  feedback: '反馈',
  project: '项目',
  reference: '参考',
};

function label(ev: MemoryEventRecord): string {
  const n = ev.items.length;
  if (ev.action === 'recalled') return `想起了 ${n} 条记忆`;
  if (ev.action === 'wrote') return n === 1 ? `已记住 · ${ev.items[0].name}` : `已记住 ${n} 条`;
  return n === 1 ? `已删除记忆 · ${ev.items[0].name}` : `已删除 ${n} 条记忆`;
}

/** Inline "已记住 / 想起了" row — expandable, with per-item undo on writes. */
export default function MemoryEventRow({
  event,
  sessionId,
}: {
  event: MemoryEventRecord;
  sessionId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const Icon = event.action === 'recalled' ? BookOpen : event.action === 'wrote' ? Brain : Trash2;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full select-none items-center gap-2 py-1 text-left text-ink-muted transition-opacity duration-150 hover:opacity-80"
      >
        <Icon size={13} className="shrink-0 text-accent" />
        <span className="text-[12px]">{label(event)}</span>
        <ChevronRight
          size={13}
          className={cn('ml-auto shrink-0 transition-transform duration-150', expanded && 'rotate-90')}
        />
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 border-l-2 border-line/70 py-1 pl-3">
          {event.items.map((item) => (
            <div key={item.file} className="group flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-[12px] text-ink-muted/90">
                <span className="font-medium text-ink">{item.name}</span>
                {item.type && (
                  <span className="ml-1.5 rounded bg-paper-inset px-1 py-px text-[10px] text-ink-muted">
                    {TYPE_LABEL[item.type] ?? item.type}
                  </span>
                )}
                {item.description && (
                  <span className="mt-0.5 block text-ink-muted/70">{item.description}</span>
                )}
              </span>
              {event.action === 'wrote' && sessionId && (
                <button
                  type="button"
                  title="删除这条记忆"
                  disabled={busy === item.file}
                  onClick={async () => {
                    setBusy(item.file);
                    try {
                      await forgetMemoryItem(sessionId, event.id, item.file);
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="shrink-0 rounded p-1 text-ink-muted/60 opacity-0 transition-opacity hover:bg-paper-inset hover:text-ink group-hover:opacity-100"
                >
                  <Undo2 size={12} />
                </button>
              )}
            </div>
          ))}
          {event.items.length === 0 && (
            <p className="text-[12px] text-ink-muted/60">已删除</p>
          )}
        </div>
      )}
    </div>
  );
}
