import { useEffect, useState, type RefObject } from 'react';
import { Quote } from 'lucide-react';
import { QUOTE_SELECTION_EVENT } from '../../../shared/quoteSelection';

interface Anchor { x: number; y: number; text: string }

/** Floating "引用" button over selected conversation text; hands the text to the composer. */
export default function QuoteSelectionButton({ containerRef, sessionId }: { containerRef: RefObject<HTMLElement | null>; sessionId: string }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    const read = () => {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) { setAnchor(null); return; }
      const range = selection.getRangeAt(0);
      const common = range.commonAncestorContainer;
      const inside = container.contains(common.nodeType === Node.TEXT_NODE ? common.parentNode : common);
      const host = (common.nodeType === Node.TEXT_NODE ? common.parentElement : (common as HTMLElement)) ?? null;
      const typing = host?.closest('input, textarea, [contenteditable="true"]');
      // Only conversation text can be quoted — not the composer, panels or chrome.
      const inLog = Boolean(host?.closest('[role="log"]'));
      const text = selection.toString();
      if (!inside || typing || !inLog || !text.trim()) { setAnchor(null); return; }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { setAnchor(null); return; }
      setAnchor({ x: rect.left + rect.width / 2, y: rect.top, text });
    };
    const onMouseUp = () => window.setTimeout(read, 0);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onMouseUp);
    const onSelectionChange = () => { if (window.getSelection()?.isCollapsed) setAnchor(null); };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [containerRef]);

  if (!anchor) return null;
  return (
    <button
      type="button"
      // Keep the selection alive through the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        window.dispatchEvent(new CustomEvent(QUOTE_SELECTION_EVENT, { detail: { sessionId, text: anchor.text } }));
        window.getSelection()?.removeAllRanges();
        setAnchor(null);
      }}
      style={{ left: anchor.x, top: Math.max(8, anchor.y - 36) }}
      className="fixed z-50 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-paper-raised px-2.5 py-1 text-[12px] text-ink shadow-[var(--shadow-panel)] transition-colors hover:bg-paper-inset"
    >
      <Quote size={12} />
      引用
    </button>
  );
}
