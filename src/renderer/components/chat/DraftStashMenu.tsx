import { useEffect, useRef, useState } from 'react';
import { Archive, X } from 'lucide-react';
import { stashPreview } from '../../../shared/draftStash';
import { draftStash, useDraftStash } from '../../state/draftStashStore';

/** A pill above the composer while drafts are shelved (Ctrl/Cmd+Shift+S); opens a list to bring one back or drop it. */
export default function DraftStashMenu({ onRestore }: { onRestore: (text: string) => void }) {
  const entries = useDraftStash();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent): void => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (entries.length === 0) setOpen(false); }, [entries.length]);

  if (entries.length === 0) return null;
  return (
    <div ref={root} className="pointer-events-auto absolute bottom-full left-0 mb-1.5">
      {open ? (
        <ul role="menu" aria-label="暂存的草稿" className="absolute bottom-full left-0 mb-1.5 w-72 max-w-[80vw] space-y-0.5 rounded-xl border border-line bg-paper-raised p-1 shadow-lg">
          {entries.map((entry) => (
            <li key={entry.id} role="none" className="group flex items-center gap-1 rounded-lg hover:bg-paper-inset">
              <button type="button" role="menuitem" onClick={() => { onRestore(entry.text); draftStash.remove(entry.id); setOpen(false); }} className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-xs text-ink" title={entry.text}>
                {stashPreview(entry.text)}
              </button>
              <button type="button" aria-label="删除这条暂存" onClick={() => draftStash.remove(entry.id)} className="mr-1 rounded p-1 text-ink-muted opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-line bg-paper-raised/90 px-2.5 py-1 text-[11px] font-medium text-ink-muted shadow-sm backdrop-blur-sm transition-colors hover:text-ink"
      >
        <Archive size={11} />
        暂存 {entries.length}
      </button>
    </div>
  );
}
