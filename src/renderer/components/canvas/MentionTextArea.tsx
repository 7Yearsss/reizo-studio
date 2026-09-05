import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
} from 'react';
import type { CanvasNode } from '../../../shared/canvas';
import { parseMentionTokens, serializeMention } from '../../../shared/resolveMentions';
import { cn } from '../../lib/cn';
import MentionMenu from './MentionMenu';

export interface MentionTextAreaHandle {
  insertMentionNode: (node: CanvasNode) => void;
  focus: () => void;
}

export interface MentionTextAreaProps {
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
  /** Fired when user clicks an inline chip in the prompt — e.g. spotlight/focus on canvas */
  onChipClick?: (nodeId: string) => void;
  /** Pinned upstream source node IDs to prioritize at top of mention menu */
  pinnedNodeIds?: string[];
  autoFocus?: boolean;
  /** 'flat' removes all outer borders, backgrounds, and focus rings for seamless integration inside floating panels */
  variant?: 'default' | 'flat';
}

const CHIP_ATTR = 'data-mention-id';
const SPACE_AFTER_CHIP = ' ';

/**
 * A `contentEditable` prompt field that renders `@[label](canvas:id)` tokens as
 * atomic inline chips. The DOM is kept flat — only text nodes and chip
 * `<span>`s — so serialising back to the canonical string is deterministic.
 */
const MentionTextArea = forwardRef<MentionTextAreaHandle, MentionTextAreaProps>(
  function MentionTextArea(
    {
      value,
      onChange,
      onCommit,
      candidates,
      placeholder,
      className,
      minRows = 2,
      onMentionSelect,
      onChipClick,
      pinnedNodeIds,
      autoFocus = false,
      variant = 'default',
    },
    refHandle,
  ) {
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
          const label =
            span.dataset.mentionLabel ??
            span.querySelector('.mention-chip-label')?.textContent?.replace(/^@/, '') ??
            '';
          out += serializeMention(label, id);
        } else {
          out += span.textContent ?? '';
        }
      }
    });
    return out;
  }, []);

  const emit = useCallback(() => {
    const next = serialize();
    lastValue.current = next;
    onChange(next);
  }, [onChange, serialize]);

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
          const nodeObj = candidates.find((n) => n.id === tok.id);
          const chip = makeChip(
            tok.id,
            labelOf(tok.id, tok.label),
            nodeObj?.type,
            () => {
              chip.remove();
              emit();
            },
            onChipClick ? () => onChipClick(tok.id) : undefined,
          );
          el.appendChild(chip);
        }
      }
      // A trailing chip needs a text node after it so the caret can land there.
      if (el.lastChild && el.lastChild.nodeType === Node.ELEMENT_NODE) {
        el.appendChild(document.createTextNode(''));
      }
    },
    [candidates, emit, labelOf, onChipClick],
  );

  // Repaint only when `value` changed outside this component.
  useLayoutEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    paint(value);
  }, [value, paint]);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
    }
  }, [autoFocus]);

  // Keep chip labels fresh when a referenced node is renamed elsewhere.
  useEffect(() => {
    const el = ref.current;
    if (!el || menu) return;
    let changed = false;
    el.querySelectorAll(`[${CHIP_ATTR}]`).forEach((span) => {
      const id = span.getAttribute(CHIP_ATTR);
      if (!id) return;
      const next = labelOf(id, (span as HTMLElement).dataset.mentionLabel ?? '');
      if ((span as HTMLElement).dataset.mentionLabel !== next) {
        (span as HTMLElement).dataset.mentionLabel = next;
        const labelEl = span.querySelector('.mention-chip-label');
        if (labelEl) labelEl.textContent = `@${next}`;
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
      const nodeObj = candidates.find((c) => c.id === node.id) || node;
      const chip = makeChip(
        node.id,
        node.title || node.id.slice(0, 6),
        nodeObj.type,
        () => {
          chip.remove();
          emit();
        },
        onChipClick ? () => onChipClick(node.id) : undefined,
      );
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
    [candidates, emit, onChipClick, onMentionSelect],
  );

  /** Expose imperative insertion for external buttons (e.g. quick-add suggestion pills) */
  const insertMentionNode = useCallback(
    (node: CanvasNode) => {
      const el = ref.current;
      if (!el) return;

      const sel = window.getSelection();
      let range: Range | null = null;
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
      }

      if (
        range &&
        range.startContainer.nodeType === Node.TEXT_NODE &&
        el.contains(range.startContainer)
      ) {
        const container = range.startContainer;
        const text = container.textContent ?? '';
        const caret = range.startOffset;

        const before = text.slice(0, caret);
        const after = text.slice(caret);
        const beforeNode = document.createTextNode(before);
        const nodeObj = candidates.find((c) => c.id === node.id) || node;
        const chip = makeChip(
          node.id,
          node.title || node.id.slice(0, 6),
          nodeObj.type,
          () => {
            chip.remove();
            emit();
          },
          onChipClick ? () => onChipClick(node.id) : undefined,
        );
        const spaceNode = document.createTextNode(SPACE_AFTER_CHIP + after);

        const parent = container.parentNode;
        if (parent) {
          parent.replaceChild(spaceNode, container);
          parent.insertBefore(chip, spaceNode);
          parent.insertBefore(beforeNode, chip);

          const r = document.createRange();
          r.setStart(spaceNode, 1);
          r.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(r);

          el.focus();
          emit();
          onMentionSelect?.(node);
          return;
        }
      }

      // Otherwise append to end of prompt
      const serialized = serializeMention(node.title || node.id.slice(0, 6), node.id);
      const currentVal = serialize().trim();
      const next = currentVal ? `${currentVal} ${serialized} ` : `${serialized} `;
      lastValue.current = next;
      onChange(next);
      onMentionSelect?.(node);
    },
    [candidates, emit, onChange, onChipClick, onMentionSelect, serialize],
  );

  useImperativeHandle(refHandle, () => ({
    insertMentionNode,
    focus: () => ref.current?.focus(),
  }));

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
        onWheel={(e) => e.stopPropagation()}
        className={cn(
          'mention-input nodrag nopan nowheel w-full resize-none whitespace-pre-wrap break-words text-xs text-ink outline-none leading-relaxed transition-all',
          variant === 'flat'
            ? 'border-0 bg-transparent p-0 focus:ring-0 focus:border-0 focus:outline-none placeholder:text-ink-muted/40 selection:bg-accent/25'
            : 'rounded-xl border border-line/60 bg-paper-inset/40 p-2.5 focus:border-accent focus:bg-paper-inset/70 focus:ring-1 focus:ring-accent/30',
          className,
        )}
        style={{ minHeight: `${minRows * 1.6 + 1.4}em` }}
      />
      {menu && (
        <MentionMenu
          candidates={candidates}
          pinnedNodeIds={pinnedNodeIds}
          query={menu.query}
          onSelect={insertMention}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
});

export default MentionTextArea;

function makeChip(
  id: string,
  label: string,
  type?: string,
  onRemove?: () => void,
  onClick?: () => void,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute(CHIP_ATTR, id);
  span.dataset.mentionLabel = label;
  span.contentEditable = 'false';

  let chipColors = 'border-accent/35 bg-accent/15 text-accent hover:border-accent/60 hover:bg-accent/25';
  let closeColors = 'text-accent/60 hover:bg-accent/25 hover:text-accent';

  if (type === 'note') {
    chipColors = 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/20';
    closeColors = 'text-emerald-400/60 hover:bg-emerald-500/20 hover:text-emerald-400';
  } else if (type === 'image') {
    chipColors = 'border-indigo-500/30 bg-indigo-500/12 text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-500/20';
    closeColors = 'text-indigo-400/60 hover:bg-indigo-500/20 hover:text-indigo-400';
  } else if (type === 'video') {
    chipColors = 'border-rose-500/30 bg-rose-500/12 text-rose-400 hover:border-rose-500/50 hover:bg-rose-500/20';
    closeColors = 'text-rose-400/60 hover:bg-rose-500/20 hover:text-rose-400';
  } else if (type === 'audio') {
    chipColors = 'border-amber-500/30 bg-amber-500/12 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/20';
    closeColors = 'text-amber-400/60 hover:bg-amber-500/20 hover:text-amber-400';
  } else if (type === 'agent') {
    chipColors = 'border-sky-500/30 bg-sky-500/12 text-sky-400 hover:border-sky-500/50 hover:bg-sky-500/20';
    closeColors = 'text-sky-400/60 hover:bg-sky-500/20 hover:text-sky-400';
  }

  span.className =
    `mention-chip group mx-1 inline-flex select-none items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline text-[11px] font-medium transition-all cursor-pointer shadow-xs ${chipColors}`;

  // 1. Icon badge
  const iconSpan = document.createElement('span');
  iconSpan.className = 'mention-chip-icon flex items-center text-[10px] select-none opacity-85';
  let iconText = '✨';
  if (type === 'note') iconText = '📝';
  else if (type === 'image') iconText = '🖼️';
  else if (type === 'video') iconText = '🎬';
  else if (type === 'audio') iconText = '🎵';
  else if (type === 'agent') iconText = '🤖';
  iconSpan.textContent = iconText;
  span.appendChild(iconSpan);

  // 2. Text label
  const textSpan = document.createElement('span');
  textSpan.className = 'mention-chip-label max-w-[140px] truncate select-none';
  textSpan.textContent = `@${label}`;
  span.appendChild(textSpan);

  // 3. Close button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.tabIndex = -1;
  closeBtn.title = '移除此引用';
  closeBtn.className =
    `mention-chip-close ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${closeColors}`;
  closeBtn.innerHTML =
    '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  closeBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove?.();
  });
  span.appendChild(closeBtn);

  if (onClick) {
    span.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.mention-chip-close')) return;
      e.stopPropagation();
      onClick();
    });
  }

  return span;
}
