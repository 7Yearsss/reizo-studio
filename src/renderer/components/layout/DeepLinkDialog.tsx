import { useEffect, useState, type ReactElement } from 'react';
import { Dialog } from 'radix-ui';
import { Loader2, X } from 'lucide-react';
import type { DeepLinkAction } from '../../../shared/deepLink';
import * as skillStore from '../../state/skillStore';

/** A `reizo://` link asked to install a skill. Nothing is written until the user presses 安装; the skill text is shown first. */
export default function DeepLinkDialog(): ReactElement {
  const [queue, setQueue] = useState<DeepLinkAction[]>([]);
  const [markdown, setMarkdown] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = queue[0];

  useEffect(() => window.reizo?.onDeepLink?.((action) => setQueue((q) => [...q, action])), []);

  useEffect(() => {
    setMarkdown(undefined);
    setError(null);
    if (!current) return;
    let cancelled = false;
    void window.reizo.previewSkillHubSkill({ slug: current.slug, namespace: current.namespace, ...(current.version ? { version: current.version } : {}) }).then(
      (text) => { if (!cancelled) setMarkdown(text); },
      (): void => { if (!cancelled) setMarkdown(null); },
    );
    return (): void => { cancelled = true; };
  }, [current]);

  const next = (): void => setQueue((q) => q.slice(1));

  async function install(): Promise<void> {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await window.reizo.installSkillHubSkill({ slug: current.slug, namespace: current.namespace, ...(current.version ? { version: current.version } : {}) });
      await skillStore.loadSkills();
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={Boolean(current)} onOpenChange={(open) => { if (!open && !busy) next(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-paper-raised p-5 shadow-2xl outline-none">
          <div className="flex items-center">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">安装技能「{current?.slug}」？</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-ink-muted hover:text-ink" aria-label="关闭"><X size={16} /></Dialog.Close>
          </div>
          <Dialog.Description className="text-xs text-ink-muted">
            来自链接 · {current?.namespace}/{current?.slug}{current?.version ? ` · v${current.version}` : ''}。技能会影响助手的做法，安装前请看一下内容。
          </Dialog.Description>
          <pre className="min-h-[6rem] flex-1 overflow-auto whitespace-pre-wrap rounded-lg bg-paper-inset p-3 text-[11px] leading-relaxed">
            {markdown === undefined ? '加载中…' : markdown === null ? '无法读取技能内容，建议先不要安装。' : markdown}
          </pre>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={next} disabled={busy} className="rounded-full px-4 py-1.5 text-xs text-ink-muted hover:text-ink">取消</button>
            <button type="button" onClick={() => void install()} disabled={busy || markdown === undefined} className="inline-flex items-center gap-1 rounded-full bg-ink px-4 py-1.5 text-xs text-paper-raised hover:opacity-85 disabled:opacity-60">
              {busy && <Loader2 size={11} className="animate-spin" />}安装
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
