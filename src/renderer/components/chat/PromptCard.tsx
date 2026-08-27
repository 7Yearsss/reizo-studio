import { useRef, type ReactNode } from 'react';
import { Send, Square } from 'lucide-react';
import { cn } from '../../lib/cn';
import { isImeComposingEvent } from '../../lib/ime';

export default function PromptCard({
  value,
  onChange,
  onSubmit,
  onStop,
  placeholder,
  disabled = false,
  sending = false,
  autoFocus = false,
  rows = 3,
  className,
  toolbar,
  onKeyDown,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  placeholder: string;
  disabled?: boolean;
  sending?: boolean;
  autoFocus?: boolean;
  rows?: number;
  className?: string;
  toolbar?: ReactNode;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  hint?: string;
}) {
  const canSend = !disabled && Boolean(value.trim());
  const composingRef = useRef(false);

  return (
    <div
      className={cn(
        'rounded-[28px] border border-line bg-paper-raised px-5 py-4 shadow-[0_8px_30px_rgba(28,22,18,0.06)]',
        className,
      )}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key !== 'Enter') return;
          if (isImeComposingEvent(e, composingRef.current)) return;
          if (e.shiftKey) return;
          e.preventDefault();
          if (canSend) onSubmit();
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        autoFocus={autoFocus}
        title={hint ?? 'Enter 发送 · Shift+Enter 换行'}
        className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-60"
      />
      <div className="mt-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
        {sending ? (
          <>
            {canSend && (
              <button
                type="button"
                onClick={onSubmit}
                className="rounded-full bg-paper px-2 py-1 text-[11px] text-ink hover:bg-paper-inset"
              >
                排队
              </button>
            )}
            <button
              type="button"
              onClick={onStop}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-paper-raised transition-opacity duration-200 hover:opacity-90"
              aria-label="停止"
            >
              <Square size={12} fill="currentColor" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200',
              canSend ? 'bg-accent text-accent-ink hover:opacity-90' : 'bg-paper text-ink-muted',
            )}
            aria-label="发送"
            title="Enter 发送 · Shift+Enter 换行"
          >
            <Send size={15} />
          </button>
        )}
      </div>
      {hint && <p className="mt-2 px-0.5 text-[10px] leading-none text-ink-muted">{hint}</p>}
    </div>
  );
}
