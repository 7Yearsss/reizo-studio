import { RotateCcw, X } from 'lucide-react';

/**
 * Shown when a session's turn markers say a reply was in flight when the
 * connection or the app dropped, and a resume attempt didn't bring it back.
 * Purely a UI state — no row is inserted into the message stream.
 */
export default function InterruptedTurnBanner({
  onRetry,
  onDismiss,
}: {
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-8 mb-2 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-ink">
      <span className="flex-1">上次回复被中断。</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 rounded-full bg-paper-inset px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-paper"
      >
        <RotateCcw size={12} />
        继续
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full p-1 text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink"
        title="忽略"
      >
        <X size={13} />
      </button>
    </div>
  );
}
