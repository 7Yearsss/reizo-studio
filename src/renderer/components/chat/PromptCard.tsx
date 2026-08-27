import type { ReactNode } from 'react';
import { Send, Square } from 'lucide-react';
import { cn } from '../../lib/cn';

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
}) {
  const canSend = !disabled && Boolean(value.trim());

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
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        autoFocus={autoFocus}
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
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-paper-raised hover:opacity-90"
              aria-label="Stop"
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
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              canSend ? 'bg-accent text-accent-ink hover:opacity-90' : 'bg-paper text-ink-muted',
            )}
            aria-label="Send"
          >
            <Send size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
