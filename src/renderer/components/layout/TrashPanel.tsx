import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import * as api from '../../api';
import * as chatStore from '../../state/chatStore';
import { toast } from '../../lib/toast';

function daysLeft(deletedAt: string, retentionDays: number): number {
  const elapsed = (Date.now() - Date.parse(deletedAt)) / 86_400_000;
  return Math.max(0, Math.ceil(retentionDays - elapsed));
}

/** Recently deleted conversations: restore (artifacts included) or remove for good. */
export default function TrashPanel() {
  const [items, setItems] = useState<api.TrashedSession[]>([]);
  const [retention, setRetention] = useState(30);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listTrashedSessions();
      setItems(data.sessions);
      setRetention(data.retentionDays);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (items.length === 0) return <p className="px-3 py-1.5 text-xs text-ink-muted">暂无</p>;

  return (
    <div className="space-y-0.5 px-1 pb-2">
      {items.map((item) => (
        <div key={item.id} className="group flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] text-ink-muted hover:bg-[var(--sidebar-hover)]">
          <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
          <span className="shrink-0 text-[11px] opacity-70 group-hover:hidden">{daysLeft(item.deletedAt, retention)} 天</span>
          <button
            type="button"
            aria-label="恢复"
            title="恢复"
            onClick={() => void chatStore.restoreSession(item.id).then(refresh, () => toast.error('恢复失败'))}
            className="hidden size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:text-ink group-hover:inline-flex"
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            aria-label="彻底删除"
            title="彻底删除"
            onClick={() => void api.deleteSessionPermanently(item.id).then(refresh, () => toast.error('删除失败'))}
            className="hidden size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:text-danger group-hover:inline-flex"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
