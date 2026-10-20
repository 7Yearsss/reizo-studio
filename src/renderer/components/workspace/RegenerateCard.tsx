import { useState } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { isImeComposingEvent } from '../../lib/ime';

/** One-click directions for rewriting a suggestion again; each sends immediately. */
export const REGENERATE_PRESETS = ['更简短', '更正式', '更口语', '保留更多原意'] as const;

/** The small card for "重写这条": say how it should change, or pick a direction. */
export default function RegenerateCard({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit(feedback: string): void; onCancel(): void }) {
  const [text, setText] = useState('');
  const send = (feedback: string) => { const value = feedback.trim(); if (value && !busy) onSubmit(value); };
  if (busy) {
    return (
      <div role="status" className="flex w-[340px] items-center gap-2.5 rounded-2xl bg-paper-raised py-2 pl-3.5 pr-2 text-sm text-ink shadow-[var(--shadow-outline),0_8px_32px_rgba(25,47,80,0.16)]">
        <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" />
        <span className="min-w-0 flex-1">正在重写…</span>
      </div>
    );
  }
  return (
    <div role="dialog" aria-label="重写这条建议" className="w-[340px] rounded-2xl bg-paper-raised shadow-[var(--shadow-outline),0_8px_32px_rgba(25,47,80,0.16)]">
      <div className="flex items-center gap-1 py-1.5 pl-3.5 pr-1.5">
        <input
          autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="想怎么改？" aria-label="重写要求"
          onKeyDown={(event) => {
            if (isImeComposingEvent(event)) return;
            if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
            else if (event.key === 'Enter') { event.preventDefault(); send(text); }
          }}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        <button type="button" aria-label="发送" disabled={!text.trim()} onClick={() => send(text)} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper-raised transition-opacity disabled:opacity-25"><ArrowUp className="size-4" /></button>
      </div>
      {!text && (
        <div className="flex flex-wrap gap-1 border-t border-line px-2 py-1.5">
          {REGENERATE_PRESETS.map((preset) => (
            <button key={preset} type="button" onClick={() => send(preset)} className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink">{preset}</button>
          ))}
        </div>
      )}
    </div>
  );
}
