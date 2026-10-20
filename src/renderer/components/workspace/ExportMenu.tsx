import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileDiff, FileText } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * Export as Word. A document that was imported from a .docx can also be exported with what changed since
 * import written as Word tracked changes, so a colleague can accept or reject each edit in Word.
 */
export default function ExportMenu({ disabled, canTrackChanges, onExport }: {
  disabled?: boolean;
  canTrackChanges: boolean;
  onExport(revisions: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!canTrackChanges) {
    return <Button size="xs" variant="outline" title="导出为 Word" disabled={disabled} onClick={() => onExport(false)}><Download data-icon="inline-start" />导出</Button>;
  }
  const item = 'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink';
  return (
    <div className="relative" ref={root}>
      <Button size="xs" variant="outline" title="导出为 Word" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download data-icon="inline-start" />导出<ChevronDown data-icon="inline-end" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-44 rounded-2xl bg-paper-raised p-1.5 shadow-[var(--shadow-outline),0_8px_40px_rgba(25,47,80,0.15)]">
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onExport(false); }}><FileText size={15} />Word 文档</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onExport(true); }}><FileDiff size={15} />Word · 带修订</button>
        </div>
      )}
    </div>
  );
}
