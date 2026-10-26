import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Dialog } from 'radix-ui';
import { Check, Loader2, X } from 'lucide-react';
import { MAX_COMPARE, MIN_COMPARE, type CompareResult } from '../../../shared/compare';
import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';
import * as api from '../../api';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import MarkdownContent from './MarkdownContent';

interface Option { key: string; providerId: string; model: string; label: string }

/** Ask the same question to 2–4 models and read the answers side by side; one click makes a model the current one. */
export default function CompareDialog({ open, onOpenChange, initialText }: { open: boolean; onOpenChange: (open: boolean) => void; initialText: string }): ReactElement {
  const settings = useSettingsStore((s) => s.settings);
  const [text, setText] = useState(initialText);
  const [chosen, setChosen] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CompareResult[] | null>(null);

  useEffect(() => { if (open) { setText(initialText); setResults(null); } }, [open, initialText]);

  const options = useMemo<Option[]>(() => settings.providers
    .filter((p) => p.hasKey)
    .flatMap((p) => {
      const models = p.models.length ? p.models : p.model ? [{ id: p.model, name: p.model }] : [];
      return models.map((m) => ({ key: `${p.id}\u0000${m.id}`, providerId: p.id, model: m.id, label: `${m.name || m.id} · ${p.name}` }));
    }), [settings.providers]);

  function toggle(key: string): void {
    setChosen((current) => (current.includes(key) ? current.filter((k) => k !== key) : current.length >= MAX_COMPARE ? current : [...current, key]));
  }

  async function run(): Promise<void> {
    const targets = chosen.map((key) => options.find((o) => o.key === key)).filter((o): o is Option => !!o).map((o) => ({ providerId: o.providerId, model: o.model }));
    setRunning(true);
    setResults(null);
    try { setResults(await api.compareModels(text, targets)); }
    catch (error) { toast.error('比较失败', error instanceof Error ? error.message : undefined); }
    finally { setRunning(false); }
  }

  function useModel(result: CompareResult): void {
    void settingsStore.patchSettings({ activeProviderId: result.providerId, provider: { id: result.providerId, model: result.model } });
    toast.success('已切换模型', result.model);
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(1000px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-paper-raised p-5 shadow-2xl outline-none">
          <div className="flex items-center">
            <Dialog.Title className="flex-1 text-base font-semibold">模型对比</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-ink-muted hover:text-ink" aria-label="关闭"><X size={16} /></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">同一个问题交给多个模型，并排查看回答</Dialog.Description>

          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="输入要比较的问题（不带对话历史，也不调用工具）" className="h-20 w-full resize-none rounded-lg bg-paper-inset p-3 text-sm outline-none" />

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="选择 2–4 个模型">
            {options.length === 0 ? <p className="text-sm text-ink-muted">先在设置里添加至少两个模型的 API Key</p> : options.map((o) => (
              <button key={o.key} type="button" onClick={() => toggle(o.key)} aria-pressed={chosen.includes(o.key)}
                className={cn('rounded-full px-3 py-1 text-xs transition-colors', chosen.includes(o.key) ? 'bg-ink text-paper-raised' : 'bg-paper-inset text-ink hover:bg-paper-inset/70')}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void run()} disabled={running || !text.trim() || chosen.length < MIN_COMPARE} className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper-raised disabled:opacity-50">
              {running ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> 比较中…</span> : '开始比较'}
            </button>
            <span className="text-xs text-ink-muted">已选 {chosen.length} / {MAX_COMPARE}（至少 {MIN_COMPARE} 个）</span>
          </div>

          {results && (
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto" style={{ gridTemplateColumns: `repeat(${results.length}, minmax(0, 1fr))` }}>
              {results.map((r) => (
                <section key={`${r.providerId}:${r.model}`} className="flex min-w-0 flex-col rounded-xl border border-line p-3">
                  <header className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
                    <span className="min-w-0 flex-1 truncate font-medium text-ink" title={r.model}>{r.model}</span>
                    <span>{(r.ms / 1000).toFixed(1)}s</span>
                  </header>
                  {r.ok ? <div className="markdown chat-prose min-h-0 flex-1 overflow-y-auto text-sm text-ink"><MarkdownContent content={r.text ?? ''} /></div> : <p className="text-sm text-danger">{r.error}</p>}
                  {r.ok && <button type="button" onClick={() => useModel(r)} className="mt-2 inline-flex items-center gap-1 self-start text-xs text-ink-muted hover:text-ink"><Check size={12} /> 用这个模型</button>}
                </section>
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
