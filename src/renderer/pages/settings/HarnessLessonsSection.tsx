import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';

/** Lessons Reizo derives from recurring tool failures in past turns; applying one adds it to the agent's prompt. */
export default function HarnessLessonsSection() {
  const auto = useSettingsStore((s) => s.settings.autoApplyHarnessLessons);
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

  return (
    <section aria-label="经验学习" className="rounded-xl border border-line bg-paper-raised p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-medium">经验学习</h2>
      <p className="mb-3 text-xs text-ink-muted">
        从过往对话里反复出现的工具失败中总结经验，采纳后加入 Agent 的提示词，之后每轮对话生效。
      </p>
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={auto}
          onChange={(event) => {
            void settingsStore.patchSettings({ autoApplyHarnessLessons: event.target.checked });
            if (event.target.checked) void reload();
          }}
        />
        自动采纳，不再逐条确认
      </label>
      {!auto && pending.length > 0 && (
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
                className={cn('mt-2 rounded-full bg-paper-inset px-3 py-1.5 text-sm text-ink hover:bg-paper-inset/80 disabled:opacity-50')}
              >
                采纳
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
