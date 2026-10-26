import { useEffect, useRef, useState, type ReactElement } from 'react';
import { isImeComposingEvent } from '../lib/ime';

/** The small floating box: type a question, Enter sends it to the main window as a new conversation, Esc closes. */
export default function QuickAssistant(): ReactElement {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const focus = (): void => { setText(''); window.setTimeout(() => input.current?.focus(), 0); };
    focus();
    const off = window.reizo?.onQuickReset?.(focus);
    return (): void => { off?.(); };
  }, []);

  function submit(): void {
    const value = text.trim();
    if (!value) return;
    setText('');
    void window.reizo?.quickSubmit?.(value);
  }

  return (
    <div className="flex h-screen flex-col gap-2 bg-paper p-3 text-ink" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <textarea
        ref={input}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposingEvent(e)) return;
          if (e.key === 'Escape') { e.preventDefault(); void window.reizo?.quickHide?.(); }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        placeholder="问点什么…  Enter 发送，Esc 关闭"
        className="min-h-0 flex-1 resize-none rounded-xl bg-paper-inset p-3 text-sm outline-none placeholder:text-ink-muted"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />
      <p className="px-1 text-[11px] text-ink-muted">会在主窗口里新建一个对话来回答</p>
    </div>
  );
}
