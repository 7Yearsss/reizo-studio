import { useEffect, useState, type ReactElement } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { formatShortcut, groupShortcuts } from '../../../shared/shortcutRegistry';
import { REBINDABLE_IDS, eventToKeys, resolveKeys, type RebindableId } from '../../../shared/shortcutBindings';
import { shortcutStore, useShortcutOverrides } from '../../state/shortcutStore';

export const SHOW_SHORTCUTS_EVENT = 'reizo:show-shortcuts';

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

const isRebindable = (id: string): id is RebindableId => (REBINDABLE_IDS as readonly string[]).includes(id);

/** Keyboard shortcut reference (Ctrl/⌘+/). Mount once. Rebindable rows record the next combination. */
export default function ShortcutsDialog(): ReactElement {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState<RebindableId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overrides = useShortcutOverrides();

  useEffect(() => {
    const show = (): void => setOpen(true);
    window.addEventListener(SHOW_SHORTCUTS_EVENT, show);
    return (): void => window.removeEventListener(SHOW_SHORTCUTS_EVENT, show);
  }, []);

  useEffect(() => {
    shortcutStore.recording = recording !== null;
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        setError(null);
        return;
      }
      const keys = eventToKeys(e);
      if (!keys) return;
      const check = shortcutStore.set(recording, keys);
      if (check.ok === false) {
        setError(check.reason);
        return;
      }
      setRecording(null);
      setError(null);
    };
    window.addEventListener('keydown', onKey, true);
    return (): void => {
      window.removeEventListener('keydown', onKey, true);
      shortcutStore.recording = false;
    };
  }, [recording]);

  const mac = isMac();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc while recording cancels the recording, not the dialog.
        if (!next && recording) return;
        setOpen(next);
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">快捷键</DialogTitle>
          <DialogDescription className="sr-only">应用内的键盘快捷键一览，可改键的条目点击铅笔后按下新组合</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {groupShortcuts().map(([scope, entries]) => (
            <section key={scope} aria-label={scope}>
              <h3 className="mb-1.5 text-[11px] font-medium text-ink-muted">{scope}</h3>
              <ul className="space-y-1">
                {entries.map((entry) => {
                  const rebind = isRebindable(entry.id) ? entry.id : null;
                  const keys = rebind ? resolveKeys(rebind, overrides) : entry.keys;
                  const active = rebind !== null && recording === rebind;
                  return (
                    <li key={entry.id} className="flex items-baseline justify-between gap-4 text-[13px]">
                      <span className="min-w-0 text-ink">
                        {entry.label}
                        {active && error ? <span role="alert" className="ml-2 text-[11px] text-ink-muted">{error}</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {rebind && overrides[rebind] && !active ? (
                          <button type="button" aria-label={`恢复「${entry.label}」默认快捷键`} className="rounded p-1 text-ink-muted hover:text-ink" onClick={() => shortcutStore.reset(rebind)}>
                            <RotateCcw className="size-3" />
                          </button>
                        ) : null}
                        {rebind ? (
                          <button
                            type="button"
                            aria-label={active ? '取消录制' : `修改「${entry.label}」的快捷键`}
                            className="rounded p-1 text-ink-muted hover:text-ink"
                            onClick={() => { setError(null); setRecording(active ? null : rebind); }}
                          >
                            <Pencil className="size-3" />
                          </button>
                        ) : null}
                        <kbd className="rounded-md border border-line bg-paper-inset px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                          {active ? '按下新组合…' : formatShortcut(keys, mac)}
                        </kbd>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
