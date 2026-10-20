import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import { toast } from '../../lib/toast';

/** Lessons Reizo derived from recurring tool failures in past turns; applying one adds it to the agent's prompt. */
export default function HarnessLessonsSection() {
  const [items, setItems] = useState<api.HarnessProposalDto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await api.listHarnessProposals());
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  const pending = items.filter((item) => !item.applied);
  if (pending.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-sm font-medium">待确认的经验</h2>
      <p className="mb-3 text-xs text-ink-muted">
        从过往对话里反复出现的工具失败中总结。采纳后会加入 Agent 的提示词，之后每轮对话生效。
      </p>
      <ul className="space-y-2">
        {pending.map((item) => (
          <li key={item.id} className="rounded-2xl bg-paper px-4 py-3">
            <div className="text-sm font-medium text-ink">{item.title}</div>
            <div className="mt-1 text-xs text-ink-muted">{item.rationale}</div>
            <button
              disabled={busy === item.id}
              onClick={async () => {
                setBusy(item.id);
                try {
                  await api.applyHarnessProposal(item.id);
                  toast.success('已采纳');
                  await reload();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : '采纳失败');
                } finally {
                  setBusy(null);
                }
              }}
              className="mt-2 rounded-full bg-paper-inset px-3 py-1.5 text-sm text-ink hover:bg-paper-inset/80 disabled:opacity-50"
            >
              采纳
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
