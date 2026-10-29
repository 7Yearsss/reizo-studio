import { useEffect, useState, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { formatShortcut, groupShortcuts } from '../../../shared/shortcutRegistry';

export const SHOW_SHORTCUTS_EVENT = 'reizo:show-shortcuts';

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Keyboard shortcut reference (Ctrl/⌘+/). Mount once. */
export default function ShortcutsDialog(): ReactElement {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = (): void => setOpen(true);
    window.addEventListener(SHOW_SHORTCUTS_EVENT, show);
    return (): void => window.removeEventListener(SHOW_SHORTCUTS_EVENT, show);
  }, []);
  const mac = isMac();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">快捷键</DialogTitle>
          <DialogDescription className="sr-only">应用内的键盘快捷键一览</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {groupShortcuts().map(([scope, entries]) => (
            <section key={scope} aria-label={scope}>
              <h3 className="mb-1.5 text-[11px] font-medium text-ink-muted">{scope}</h3>
              <ul className="space-y-1">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-4 text-[13px]">
                    <span className="min-w-0 text-ink">{entry.label}</span>
                    <kbd className="shrink-0 rounded-md border border-line bg-paper-inset px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">{formatShortcut(entry.keys, mac)}</kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
