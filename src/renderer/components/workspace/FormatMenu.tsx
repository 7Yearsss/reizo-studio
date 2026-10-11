import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileUp, Type } from 'lucide-react';
import { FORMAT_PRESETS, FORMAT_ROLES, ROLE_LABELS, type FormatResult, type FormatSpec } from '../../../shared/documentFormat';
import { Button } from '../ui/button';
import { cn } from '../../lib/cn';

/** Typeset by a preset or by a reference document. Choosing one previews it on the page; nothing is saved until it is applied. */
export default function FormatMenu({ disabled, onPick, onPickReference }: {
  disabled?: boolean;
  onPick(spec: FormatSpec): void;
  onPickReference(file: File): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const item = 'flex w-full flex-col items-start gap-0.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-paper-inset';
  return (
    <div className="relative" ref={root}>
      <input ref={input} type="file" hidden accept=".docx" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) { setOpen(false); onPickReference(file); } }} />
      <Button size="xs" variant="ghost" title="排版" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Type data-icon="inline-start" />排版<ChevronDown data-icon="inline-end" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-2xl bg-paper-raised p-1.5 shadow-[var(--shadow-outline),0_8px_40px_rgba(25,47,80,0.15)]">
          {FORMAT_PRESETS.map((spec) => (
            <button key={spec.id} type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onPick(spec); }}>
              <span className="text-[13px] text-ink">{spec.name}</span>
              <span className="text-xs text-ink-muted">{spec.id === 'official' ? '仿宋三号 · 固定行距 28 磅 · 首行缩进 2 字' : '宋体小四 · 1.5 倍行距 · 黑体标题'}</span>
            </button>
          ))}
          <div className="mx-2 my-1 h-px bg-line" />
          <button type="button" role="menuitem" className={cn(item, 'flex-row items-center gap-2.5')} onClick={() => input.current?.click()}>
            <FileUp size={15} className="shrink-0 text-ink-muted" />
            <span className="text-[13px] text-ink">按范文排版…</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The bar over a previewed layout: what was recognised, a flip between before and after, and the decision. */
export function FormatPreviewBar({ name, result, view, onView, onApply, onCancel }: {
  name: string;
  result: FormatResult;
  view: 'after' | 'before';
  onView(view: 'after' | 'before'): void;
  onApply(): void;
  onCancel(): void;
}) {
  const parts = FORMAT_ROLES.filter((role) => result.counts[role]).map((role) => `${ROLE_LABELS[role]} ${result.counts[role]}`);
  const seg = (active: boolean) => cn('h-7 rounded-[9px] px-2.5 text-xs transition-colors', active ? 'bg-paper-raised text-ink shadow-[var(--shadow-outline)]' : 'text-ink-muted hover:text-ink');
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-paper-inset px-3 py-2 text-xs">
      <span className="font-medium text-ink">{name}</span>
      <span className="min-w-0 flex-1 truncate text-ink-muted">{parts.join(' · ')}</span>
      <div className="flex gap-0.5 rounded-xl bg-paper p-0.5">
        <button type="button" className={seg(view === 'after')} aria-pressed={view === 'after'} onClick={() => onView('after')}>排版后</button>
        <button type="button" className={seg(view === 'before')} aria-pressed={view === 'before'} onClick={() => onView('before')}>原样</button>
      </div>
      <Button size="xs" variant="ghost" onClick={onCancel}>取消</Button>
      <Button size="xs" onClick={onApply}>应用</Button>
    </div>
  );
}
