import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import * as api from '../../api';
import { toast } from '../../lib/toast';

/** Earlier versions of a skill (kept before each AI refinement); one click puts a version back. Renders nothing without history. */
export default function SkillHistoryMenu({ skillId }: { skillId: string }) {
  const [items, setItems] = useState<api.SkillHistoryItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.getSkillHistory(skillId).then((list) => { if (!cancelled) setItems(list); }, (): void => undefined);
    return () => { cancelled = true; };
  }, [skillId]);

  if (items.length === 0) return null;

  return (
    <div className="relative mr-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
      >
        <History size={12} /> 历史版本（{items.length}）
      </button>
      {open && (
        <ul className="absolute bottom-full left-0 mb-2 max-h-60 w-72 overflow-y-auto rounded-xl border border-line bg-paper-raised p-1 shadow-lg">
          {items.map((item) => (
            <li key={item.file} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-muted hover:bg-paper-inset">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{item.reason}</span>
                <span>{new Date(item.at).toLocaleString()}</span>
              </span>
              <button
                type="button"
                className="shrink-0 rounded-full bg-ink px-2.5 py-1 text-[11px] text-paper-raised"
                onClick={() => {
                  void api.restoreSkillVersion(skillId, item.file).then(
                    () => { toast.success('已恢复该版本'); setOpen(false); void api.getSkillHistory(skillId).then(setItems); },
                    () => toast.error('恢复失败'),
                  );
                }}
              >
                恢复
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
