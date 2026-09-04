import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CanvasNode } from '../../../shared/canvas';
import { parseMentionTokens, serializeMention } from '../../../shared/resolveMentions';
import MentionMenu from './MentionMenu';

interface MentionTextAreaProps {
  /** Canonical prompt string: plain text + `@[label](canvas:id)` tokens. */
  value: string;
  onChange: (next: string) => void;
  /** Fired on blur — use to persist. */
  onCommit?: () => void;
  /** Nodes that can be @-referenced (dropdown + live label refresh). */
  candidates: CanvasNode[];
  placeholder?: string;
  className?: string;
  minRows?: number;
  /** Fired when user picks a node to mention — use to auto-wire canvas edge. */
  onMentionSelect?: (node: CanvasNode) => void;
}

const CHIP_ATTR = 'data-mention-id';
const SPACE_AFTER_CHIP = ' ';

/**
 * A `contentEditable` prompt field that renders `@[label](canvas:id)` tokens as
 * atomic inline chips. The DOM is kept flat — only text nodes and chip
 * `<span>`s — so serialising back to the canonical string is deterministic.
 */
export default function MentionTextArea({
  value,
  onChange,
  onCommit,
  candidates,
  placeholder,
  className,
  minRows = 2,
  onMentionSelect,
}: MentionTextAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  /** Last string we emitted, to skip repainting the DOM on our own edits. */
  const lastValue = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ query: string } | null>(null);
  const savedRange = useRef<Range | null>(null);

  const labelOf = useCallback(
    (id: string, fallback: string) =>
      candidates.find((n) => n.id === id)?.title || fallback || id.slice(0, 6),
    [candidates],
  );

  /** Build the flat DOM (text nodes + chip spans) from a canonical string. */
  const paint = useCallback(
    (str: string) => {
      const el = ref.current;
      if (!el) return;
      el.textContent = '';
      for (const tok of parseMentionTokens(str)) {
        if (tok.type === 'text') {
          if (tok.value) el.appendChild(document.createTextNode(tok.value));
        } else {
          el.appendChild(makeChip(tok.id, labelOf(tok.id, tok.label)));
        }
      }
      // A trailing chip needs a text node after it so the caret can land there.
      if (el.lastChild && el.lastChild.nodeType === Node.ELEMENT_NODE) {
        el.appendChild(document.createTextNode(''));
      }
    },
    [labelOf],
  );

  /** Serialise the current DOM back to the canonical string. */
  const serialize = useCallback((): string => {
    const el = ref.current;
    if (!el) return '';
    let out = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent ?? '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const span = node as HTMLElement;
        const id = span.getAttribute(CHIP_ATTR);
        if (id) {
          out += serializeMention(
            span.dataset.mentionLabel ?? span.textContent?.replace(/^@/, '') ?? '',
            id,
          );
        } else {
          out += span.textContent ?? '';
        }
      }
    });
    return out;
  }, []);

  // Repaint only when `value` changed outside this component.
  useLayoutEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    paint(value);
  }, [value, paint]);

  const emit = useCallback(() => {
    const next = serialize();
    lastValue.current = next;
    onChange(next);
  }, [onChange, serialize]);

  // Keep chip labels fresh when a referenced node is renamed elsewhere.
  useEffect(() => {
    const el = ref.current;
    if (!el || menu) return;
    let changed = false;
    el.querySelectorAll(`[${CHIP_ATTR}]`).forEach((span) => {
      const id = span.getAttribute(CHIP_ATTR);
      if (!id) return;
      const next = labelOf(id, (span as HTMLElement).dataset.mentionLabel ?? '');
      if (span.textContent !== `@${next}`) {
        span.textContent = `@${next}`;
        (span as HTMLElement).dataset.mentionLabel = next;
        changed = true;
      }
    });
    if (changed) emit();
  }, [candidates, labelOf, menu, emit]);

  const detectTrigger = useCallback(() => {
    if (composing.current) {
      setMenu(null);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      setMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !ref.current?.contains(node)) {
      setMenu(null);
      return;
    }
    const textBefore = (node.textContent ?? '').slice(0, range.startOffset);
    const m = /(^|\s)@([^\s@[\]()]*)$/.exec(textBefore);
    if (!m) {
      setMenu(null);
      return;
    }
    savedRange.current = range.cloneRange();
    setMenu({ query: m[2] });
  }, []);

  const onInput = useCallback(() => {
    emit();
    detectTrigger();
  }, [emit, detectTrigger]);

  const insertMention = useCallback(
    (node: CanvasNode) => {
      const el = ref.current;
      const range = savedRange.current;
      if (!el || !range) return;
      const container = range.startContainer;
      if (container.nodeType !== Node.TEXT_NODE) return;

      const text = container.textContent ?? '';
      const caret = range.startOffset;
      const at = text.slice(0, caret).lastIndexOf('@');
      if (at === -1) return;

      const before = text.slice(0, at);
      const after = text.slice(caret);
      const beforeNode = document.createTextNode(before);
      const chip = makeChip(node.id, node.title || node.id.slice(0, 6));
      const spaceNode = document.createTextNode(SPACE_AFTER_CHIP + after);

      const parent = container.parentNode;
      if (!parent) return;
      parent.replaceChild(spaceNode, container);
      parent.insertBefore(chip, spaceNode);
      parent.insertBefore(beforeNode, chip);

      // Caret just after the inserted trailing space.
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(spaceNode, 1);
      r.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(r);

      setMenu(null);
      savedRange.current = null;
      el.focus();
      emit();
      onMentionSelect?.(node);
    },
    [emit, onMentionSelect],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // While the menu is open, let MentionMenu own the arrows / enter / esc.
      if (menu && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        return;
      }
      if (e.key === 'Enter') {
        // Flat DOM: insert a literal newline rather than a <div>/<br>.
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
        return;
      }
      if (e.key === 'Backspace') {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
        const { startContainer, startOffset } = sel.getRangeAt(0);
        let chip: Element | null = null;
        if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
          const prev = startContainer.previousSibling as HTMLElement | null;
          if (prev?.hasAttribute?.(CHIP_ATTR)) chip = prev;
        } else if (startContainer.nodeType === Node.ELEMENT_NODE && startOffset > 0) {
          const prev = startContainer.childNodes[startOffset - 1] as HTMLElement | null;
          if (prev?.hasAttribute?.(CHIP_ATTR)) chip = prev;
        }
        if (chip) {
          e.preventDefault();
          chip.remove();
          emit();
        }
      }
    },
    [menu, emit],
  );

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  }, []);

  return (
    <div className="relative">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder ?? ''}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => {
          // Delay so a menu click lands before we tear the trigger down.
          setTimeout(() => {
            setMenu(null);
            onCommit?.();
          }, 120);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          onInput();
        }}
        className={
          'mention-input nodrag w-full resize-none whitespace-pre-wrap break-words rounded-xl border border-line/60 bg-paper-inset/40 p-2.5 text-xs text-ink outline-none focus:border-accent focus:bg-paper-inset/70 focus:ring-1 focus:ring-accent/30 transition-all leading-relaxed ' +
          (className ?? '')
        }
        style={{ minHeight: `${minRows * 1.6 + 1.4}em` }}
      />
      {menu && (
        <MentionMenu
          candidates={candidates}
          query={menu.query}
          onSelect={insertMention}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function makeChip(id: string, label: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute(CHIP_ATTR, id);
  span.dataset.mentionLabel = label;
  span.contentEditable = 'false';
  span.textContent = `@${label}`;
  span.className =
    'mention-chip mx-0.5 inline-flex select-none items-center rounded bg-accent/15 px-1 py-px align-baseline text-[11px] font-medium text-accent';
  return span;
}
