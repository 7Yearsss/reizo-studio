import { RotateCcw, X } from 'lucide-react';

/**
 * Shown when a session's turn markers say a reply was in flight when the
 * connection or the app dropped, and a resume attempt didn't bring it back.
 * Purely a UI state — no row is inserted into the message stream. Rendered as
 * a quiet inline hint instead of an alert banner: it informs, not warns.
 */
export default function InterruptedTurnBanner({
  onRetry,
  onDismiss,
}: {
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-center gap-2 text-[12px] text-ink-muted" role="status">
      <RotateCcw size={11} className="opacity-70" />
      <span>上次回复被中断</span>
      <button
        type="button"
        onClick={onRetry}
        className="font-medium text-accent underline-offset-2 transition-colors hover:underline"
      >
        重新执行
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full p-0.5 text-ink-muted transition-colors hover:text-ink"
        title="忽略"
        aria-label="忽略"
      >
        <X size={12} />
      </button>
    </div>
  );
}
