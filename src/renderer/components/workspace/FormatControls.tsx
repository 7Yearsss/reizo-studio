import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Highlighter, IndentDecrease, IndentIncrease, Pilcrow, Baseline } from 'lucide-react';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/cn';
import { readFormatState, setBlockAttrs, setRunStyle, type FormatState } from './documentFormatCommands';

const FONTS: { value: string; label: string }[] = [
  { value: '宋体', label: '宋体' }, { value: '黑体', label: '黑体' }, { value: '楷体', label: '楷体' }, { value: '仿宋', label: '仿宋' },
  { value: '微软雅黑', label: '微软雅黑' }, { value: 'Times New Roman,宋体', label: 'Times New Roman' },
  { value: 'Arial,微软雅黑', label: 'Arial' }, { value: 'Calibri,微软雅黑', label: 'Calibri' },
];
/** Chinese size names with their point sizes, then plain point sizes. */
const SIZES: { value: number; label: string }[] = [
  { value: 42, label: '初号' }, { value: 26, label: '一号' }, { value: 22, label: '二号' }, { value: 16, label: '三号' }, { value: 14, label: '四号' },
  { value: 12, label: '小四' }, { value: 10.5, label: '五号' }, { value: 9, label: '小五' },
  { value: 18, label: '18' }, { value: 20, label: '20' }, { value: 24, label: '24' }, { value: 28, label: '28' }, { value: 36, label: '36' },
];
const LINES: { value: string; label: string }[] = [
  { value: 'm1', label: '单倍' }, { value: 'm1.15', label: '1.15 倍' }, { value: 'm1.5', label: '1.5 倍' }, { value: 'm2', label: '2 倍' },
  { value: 'e20', label: '固定 20 磅' }, { value: 'e28', label: '固定 28 磅' },
];
const TEXT_COLORS = ['000000', '595959', 'C00000', 'ED7D31', '548235', '2F5597', '7030A0'];
const HIGHLIGHTS = ['FFFF00', 'C6EFCE', 'BDD7EE', 'F8CBAD', 'D9D9D9'];
/** One indent step: 2 characters of a 10.5pt body, in twips. */
const INDENT_STEP = 420;

const lineValue = (s: FormatState | null): string => (s?.lineExact ? `e${s.lineExact}` : s?.lineSpacing ? `m${s.lineSpacing}` : '');

function Swatches({ label, icon, current, colors, clearLabel, disabled, onPick }: {
  label: string;
  icon: React.ReactNode;
  current: string | null;
  colors: string[];
  clearLabel: string;
  disabled: boolean;
  onPick(color: string | null): void;
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
  return (
    <div className="relative" ref={root}>
      <Button size="icon-sm" variant="ghost" className="relative size-7" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span aria-hidden className="absolute bottom-1 left-1.5 right-1.5 h-0.5 rounded-full" style={{ background: current ? `#${current}` : 'transparent' }} />
      </Button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1.5 w-40 rounded-2xl bg-paper-raised p-2 shadow-[var(--shadow-outline),0_8px_40px_rgba(25,47,80,0.15)]" onMouseDown={(event) => event.preventDefault()}>
          <div className="grid grid-cols-5 gap-1.5">
            {colors.map((color) => (
              <button key={color} type="button" role="menuitem" aria-label={`#${color}`} onClick={() => { setOpen(false); onPick(color); }}
                className={cn('size-6 rounded-lg shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] transition-transform hover:scale-110', current === color && 'ring-2 ring-ink/50 ring-offset-1 ring-offset-paper-raised')}
                style={{ background: `#${color}` }} />
            ))}
          </div>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onPick(null); }} className="mt-2 w-full rounded-lg px-2 py-1 text-left text-xs text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink">{clearLabel}</button>
        </div>
      )}
    </div>
  );
}

function IconButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={label} aria-pressed={active} disabled={disabled}
      className={cn('size-7', active && 'bg-paper-inset text-ink')} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</Button>
  );
}

/** Font, size, colour, alignment, indent and line spacing for the selection (or the caret's paragraph). */
export default function FormatControls({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const state = useEditorState({ editor, selector: ({ editor: e }) => (e ? readFormatState(e) : null), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  const off = !editor || disabled;
  const sep = <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />;
  const trigger = 'h-7 border-transparent px-2 text-xs hover:bg-paper-inset';
  const run = editor ? { style: (patch: Parameters<typeof setRunStyle>[1]) => setRunStyle(editor, patch), block: (patch: Parameters<typeof setBlockAttrs>[1]) => setBlockAttrs(editor, patch) } : null;
  const firstLine = Boolean(state?.indentFirst);
  const sizeLabel = SIZES.find((s) => s.value === state?.size)?.label;
  return (
    <>
      {sep}
      <Select value={state?.font ?? ''} disabled={off} onValueChange={(font) => run?.style({ font })}>
        <SelectTrigger size="sm" aria-label="字体" className={cn(trigger, 'w-[6.5rem]')}><SelectValue placeholder="字体" /></SelectTrigger>
        <SelectContent><SelectGroup>{FONTS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <Select value={state?.size ? String(state.size) : ''} disabled={off} onValueChange={(size) => run?.style({ size: Number(size) })}>
        <SelectTrigger size="sm" aria-label="字号" className={cn(trigger, 'w-[4.5rem]')}><SelectValue placeholder="字号">{sizeLabel ?? state?.size}</SelectValue></SelectTrigger>
        <SelectContent><SelectGroup>{SIZES.map((s) => <SelectItem key={s.value} value={String(s.value)}>{s.label}{/^\d/.test(s.label) ? '' : ` · ${s.value}`}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <Swatches label="文字颜色" icon={<Baseline />} current={state?.color ?? null} colors={TEXT_COLORS} clearLabel="自动" disabled={off} onPick={(color) => run?.style({ color })} />
      <Swatches label="突出显示" icon={<Highlighter />} current={state?.highlight ?? null} colors={HIGHLIGHTS} clearLabel="无" disabled={off} onPick={(highlight) => run?.style({ highlight })} />
      {sep}
      <IconButton label="左对齐" active={state?.align === 'left'} disabled={off} onClick={() => run?.block({ textAlign: null })}><AlignLeft /></IconButton>
      <IconButton label="居中" active={state?.align === 'center'} disabled={off} onClick={() => run?.block({ textAlign: 'center' })}><AlignCenter /></IconButton>
      <IconButton label="右对齐" active={state?.align === 'right'} disabled={off} onClick={() => run?.block({ textAlign: 'right' })}><AlignRight /></IconButton>
      <IconButton label="两端对齐" active={state?.align === 'justify'} disabled={off} onClick={() => run?.block({ textAlign: 'justify' })}><AlignJustify /></IconButton>
      {sep}
      <IconButton label="首行缩进 2 字" active={firstLine} disabled={off} onClick={() => run?.block({ indentFirst: firstLine ? null : Math.round((state?.size ?? 10.5) * 2 * 20) })}><Pilcrow /></IconButton>
      <IconButton label="增加缩进" disabled={off} onClick={() => run?.block({ indentLeft: (state?.indentLeft ?? 0) + INDENT_STEP })}><IndentIncrease /></IconButton>
      <IconButton label="减少缩进" disabled={off || !state?.indentLeft} onClick={() => run?.block({ indentLeft: Math.max(0, (state?.indentLeft ?? 0) - INDENT_STEP) || null })}><IndentDecrease /></IconButton>
      <Select value={lineValue(state)} disabled={off} onValueChange={(value) => run?.block(value.startsWith('e') ? { lineExact: Number(value.slice(1)), lineSpacing: null } : { lineSpacing: Number(value.slice(1)), lineExact: null })}>
        <SelectTrigger size="sm" aria-label="行距" className={cn(trigger, 'w-[6rem]')}><SelectValue placeholder="行距" /></SelectTrigger>
        <SelectContent><SelectGroup>{LINES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </>
  );
}
