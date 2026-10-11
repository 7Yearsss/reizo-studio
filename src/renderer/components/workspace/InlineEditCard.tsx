import { useState } from 'react';
import { ArrowUp, Loader2, Square } from 'lucide-react';
import { isImeComposingEvent } from '../../lib/ime';

/** One-click rewrites for the things people ask for most; each sends immediately. */
export const EDIT_PRESETS = ['润色', '更简洁', '更正式', '扩写', '翻译成英文', '修正错别字'] as const;

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
      className="w-[340px] rounded-2xl bg-paper-raised p-2 shadow-[var(--shadow-outline),0_8px_40px_rgba(25,47,80,0.15)]"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {phase === 'input' && (
        <>
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (isImeComposingEvent(event)) return;
                if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
                else if (event.key === 'Enter') { event.preventDefault(); send(text); }
              }}
              placeholder={blocked ? 'AI 正在回复，稍等片刻…' : '想怎么改？例如：语气更正式一点'}
              aria-label="修改要求"
              disabled={blocked}
              className="h-9 min-w-0 flex-1 rounded-xl bg-paper-inset px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-ink/30 disabled:opacity-60"
            />
            <button
              type="button"
              aria-label="发送修改要求"
              disabled={!text.trim() || blocked}
              onClick={() => send(text)}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-paper-raised transition-opacity disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
          {!text && !blocked && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EDIT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => send(preset)}
                  className="rounded-[9px] bg-paper-inset px-2.5 py-1 text-xs text-ink-muted transition-colors hover:bg-line hover:text-ink"
                >
                  {preset}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 px-1 text-[11px] leading-4 text-ink-muted">Enter 发送 · Esc 取消 · 结果会作为待审核的修改出现在原文里</p>
        </>
      )}
      {phase === 'working' && (
        <div role="status" className="flex items-center gap-2 px-1 py-1 text-sm text-ink">
          <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" />
          <span className="min-w-0 flex-1">{waiting ? 'AI 需要你在对话里确认后才能继续' : 'AI 正在改写…'}</span>
          <button type="button" onClick={onStop} className="flex h-7 shrink-0 items-center gap-1 rounded-[9px] bg-paper-inset px-2 text-xs text-ink-muted hover:bg-line hover:text-ink">
            <Square className="size-3" />停止
          </button>
        </div>
      )}
      {phase === 'notice' && (
        <div role="status" className="flex items-center gap-2 px-1 py-1 text-sm text-ink-muted">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={onCancel} className="h-7 shrink-0 rounded-[9px] bg-paper-inset px-2 text-xs hover:bg-line hover:text-ink">知道了</button>
        </div>
      )}
    </div>
  );
}
