import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { cn } from '../../../lib/cn';

export default function EditOverlayShell({
  title,
  confirmLabel,
  onClose,
  onConfirm,
  confirming = false,
  confirmDisabled = false,
  confirmHint,
  hideActions = false,
  extraActions,
  children,
  footer,
}: {
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  confirmDisabled?: boolean;
  confirmHint?: string;
  hideActions?: boolean;
  extraActions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !hideActions && !confirmDisabled && !confirming) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onConfirm, hideActions, confirmDisabled, confirming]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-paper/80 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex shrink-0 items-center justify-between border-b border-line bg-paper px-5 py-3 text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-medium tracking-tight">{title}</span>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="rounded-full bg-paper-inset p-1.5 text-ink hover:bg-line"
        >
          <X size={16} />
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
      <div
        className="flex shrink-0 flex-col items-center gap-3 border-t border-line bg-paper px-4 pb-5 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        {footer}
        {hideActions ? null : (
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2 rounded-full border border-line bg-paper-raised/95 px-2 py-1.5 shadow-lg backdrop-blur-md">
              {extraActions}
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-3 py-1.5 text-[12px] text-ink-muted hover:bg-paper-inset hover:text-ink"
              >
                取消
              </button>
              <button
                type="button"
                disabled={confirmDisabled || confirming}
                title={confirmDisabled ? confirmHint : undefined}
                onClick={onConfirm}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-40',
                )}
              >
                {confirming ? <Loader2 size={12} className="animate-spin" /> : null}
                {confirmLabel}
              </button>
            </div>
            {confirmDisabled && confirmHint ? (
              <p className="text-[11px] text-ink-muted">{confirmHint}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
