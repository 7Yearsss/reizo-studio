import { useState } from 'react';
import { ArrowUp, Loader2, Square } from 'lucide-react';
import { isImeComposingEvent } from '../../lib/ime';

/** One-click rewrites for the things people ask for most; each sends immediately. */
export const EDIT_PRESETS = ['润色', '精简', '扩写', '更正式', '翻译成英文'] as const;

export type InlineEditPhase = 'input' | 'working' | 'notice';

/**
 * The small card under a selection where the instruction is typed. "input" asks, "working"
 * shows the AI is on it (with a stop), "notice" says why nothing was proposed.
 */
export default function InlineEditCard({ phase, notice, blocked, waiting, onSubmit, onCancel, onStop }: {
  phase: InlineEditPhase;
  notice?: string;
  /** The chat is mid-reply: a new instruction would only queue behind it. */
  blocked?: boolean;
  /** The turn is paused on a question or approval in the chat. */
  waiting?: boolean;
  onSubmit(instruction: string): void;
  onCancel(): void;
  onStop(): void;
}) {
  const [text, setText] = useState('');
  const send = (instruction: string) => { const value = instruction.trim(); if (value && !blocked) onSubmit(value); };
  return (
    <div
      role="dialog"
      aria-label="改写所选内容"
      className="w-[360px] rounded-2xl bg-paper-raised shadow-[var(--shadow-outline),0_8px_32px_rgba(25,47,80,0.16)]"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {phase === 'input' && (
        <>
          <div className="flex items-center gap-1 py-1.5 pl-3.5 pr-1.5">
            <input
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (isImeComposingEvent(event)) return;
                if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
                else if (event.key === 'Enter') { event.preventDefault(); send(text); }
              }}
              placeholder={blocked ? 'AI 正在回复…' : '想怎么改？'}
              aria-label="修改要求"
              disabled={blocked}
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted disabled:opacity-60"
            />
            <button
              type="button"
              aria-label="发送"
              disabled={!text.trim() || blocked}
              onClick={() => send(text)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper-raised transition-opacity disabled:opacity-25"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
          {!text && !blocked && (
            <div className="flex flex-wrap gap-1 border-t border-line px-2 py-1.5">
              {EDIT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => send(preset)}
                  className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink"
                >
                  {preset}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {phase === 'working' && (
        <div role="status" className="flex items-center gap-2.5 py-2 pl-3.5 pr-2 text-sm text-ink">
          <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" />
          <span className="min-w-0 flex-1">{waiting ? '需要你在对话里确认' : 'AI 正在改写…'}</span>
          <button type="button" onClick={onStop} className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink">
            <Square className="size-3" />停止
          </button>
        </div>
      )}
      {phase === 'notice' && (
        <div role="status" className="flex items-center gap-2.5 py-2 pl-3.5 pr-2 text-sm text-ink-muted">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={onCancel} className="h-7 shrink-0 rounded-lg px-2 text-xs transition-colors hover:bg-paper-inset hover:text-ink">好</button>
        </div>
      )}
    </div>
  );
}
