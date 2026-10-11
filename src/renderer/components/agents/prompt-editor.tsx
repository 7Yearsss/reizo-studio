import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { InputRule, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { cn } from '@/renderer/lib/cn';
import { parseDraft, serializeDraft, type DraftNode } from '@/shared/promptDraft';

/** What an inline reference chip shows: where it points and a short quote of the picked range. */
export interface ChipInfo {
  kind: string;
  name: string;
  text?: string;
}

interface ChipContextValue {
  info(label: number): ChipInfo | undefined;
  open(label: number): void;
}

const ChipContext = createContext<ChipContextValue>({ info: () => undefined, open: () => undefined });

const SNIPPET_CHARS = 14;

function ChipView({ node, selected }: NodeViewProps) {
  const context = useContext(ChipContext);
  const label = Number(node.attrs.label);
  const info = context.info(label);
  const quote = info?.text?.replace(/\s+/g, ' ').trim() ?? '';
  const snippet = quote.length > SNIPPET_CHARS ? `${quote.slice(0, SNIPPET_CHARS)}…` : quote;
  return (
    <NodeViewWrapper as="span" className="mx-0.5 inline-block align-baseline" data-reference-chip={label}>
      <button
        type="button"
        contentEditable={false}
        onClick={() => context.open(label)}
        title={info ? `${info.name}${quote ? ` · 「${quote.slice(0, 60)}」` : ''}（点击在${info.kind}中查看）` : `引用 ${label}（已移除）`}
        className={cn(
          'inline-flex max-w-[16rem] items-center gap-1 rounded-[9px] px-1.5 py-px text-[13px] leading-5 transition-colors',
          info ? 'bg-paper-inset text-ink shadow-[inset_0_0_0_1px_var(--line)] hover:bg-line' : 'bg-paper-inset text-ink-muted line-through',
          selected && 'ring-2 ring-ink/40',
        )}
      >
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold leading-none text-accent-ink tabular-nums">{label}</span>
        {snippet ? <span className="truncate">{snippet}</span> : null}
      </button>
    </NodeViewWrapper>
  );
}

const ReferenceChip = Node.create<{ isLabel: (label: number) => boolean }>({
  name: 'referenceChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ isLabel: () => false }),
  addAttributes: () => ({ label: { default: 1 } }),
  parseHTML: () => [{ tag: 'span[data-reference-chip]', getAttrs: (el) => ({ label: Number((el as HTMLElement).getAttribute('data-reference-chip')) }) }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes({ 'data-reference-chip': HTMLAttributes.label }), `[${HTMLAttributes.label}]`],
  renderText: ({ node }) => `[${node.attrs.label}]`,
  addNodeView: () => ReactNodeViewRenderer(ChipView),
  addInputRules() {
    // Typing `[2]` when range 2 exists turns it into its chip.
    return [
      new InputRule({
        find: /\[(\d{1,3})\]$/,
        handler: ({ state, range, match }) => {
          const label = Number(match[1]);
          if (!this.options.isLabel(label)) return null;
          state.tr.replaceWith(range.from, range.to, this.type.create({ label }));
          return undefined;
        },
      }),
    ];
  },
});

export interface PromptEditorHandle {
  focus(): void;
  /** Put range `label`'s chip at the caret (the end when the editor is not focused). */
  insertReference(label: number): void;
}

export interface PromptEditorProps {
  /** The draft as a plain string; `[n]` renders as a chip when `chips.info(n)` exists. */
  value: string;
  onChange(value: string): void;
  chips?: ChipContextValue;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  minRows?: number;
  maxRows?: number;
  'aria-label'?: string;
  /** Runs before the editor's own Enter handling; `textBeforeCaret` is the draft up to the caret. */
  onKeyDown?(event: KeyboardEvent, context: { textBeforeCaret: string }): void;
  /** Enter (or Ctrl/Cmd+Enter) was pressed and nothing handled it: submit. */
  onEnter(sendNow: boolean): void;
  className?: string;
}

const NO_CHIPS: ChipContextValue = { info: () => undefined, open: () => undefined };
const LINE_HEIGHT = 24;

/**
 * The composer's text box. A ProseMirror editor with one paragraph, soft line breaks and an inline
 * atom for each cited range, so a range is mentioned right where the sentence needs it.
 */
export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(function PromptEditor(
  { value, onChange, chips = NO_CHIPS, placeholder, disabled, autoFocus, minRows = 2, maxRows = 8, 'aria-label': ariaLabel = 'Prompt', onKeyDown, onEnter, className },
  ref,
) {
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  const lastEmitted = useRef(value);
  const latest = useRef({ onChange, onKeyDown, onEnter });
  latest.current = { onChange, onKeyDown, onEnter };
  const isLabel = (label: number) => chipsRef.current.info(label) !== undefined;
  const isLabelRef = useRef(isLabel);
  isLabelRef.current = isLabel;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        blockquote: false, bold: false, bulletList: false, code: false, codeBlock: false, heading: false,
        horizontalRule: false, italic: false, listItem: false, listKeymap: false, orderedList: false,
        strike: false, underline: false, link: false, dropcursor: false, gapcursor: false, trailingNode: false,
      }),
      ReferenceChip.configure({ isLabel: (label: number) => isLabelRef.current(label) }),
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: parseDraft(value, isLabel) as JSONContent,
    autofocus: autoFocus ? 'end' : false,
    editable: !disabled,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': ariaLabel,
        class: 'prompt-editor min-h-6 px-2 pt-1.5 text-sm leading-6 text-foreground outline-none whitespace-pre-wrap [overflow-wrap:break-word]',
      },
      handleKeyDown: (view, event) => {
        const { from } = view.state.selection;
        const textBeforeCaret = serializeDraft(view.state.doc.cut(0, from).toJSON() as DraftNode);
        latest.current.onKeyDown?.(event, { textBeforeCaret });
        if (event.defaultPrevented) return true;
        // Enter sends; only Shift+Enter makes a new line. An IME confirming a candidate is not a send.
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          latest.current.onEnter(Boolean(event.metaKey || event.ctrlKey));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      const text = serializeDraft(current.getJSON() as DraftNode);
      if (text === lastEmitted.current) return;
      lastEmitted.current = text;
      latest.current.onChange(text);
    },
  });

  // Changes from outside (menu picks, recalled messages, clearing after send) replace the content.
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === lastEmitted.current) return;
    lastEmitted.current = value;
    const focused = editor.isFocused;
    editor.commands.setContent(parseDraft(value, isLabelRef.current) as JSONContent, { emitUpdate: false });
    if (focused) editor.commands.focus('end');
  }, [editor, value]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled);
  }, [editor, disabled]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(undefined, { scrollIntoView: false }),
      insertReference: (label) => {
        if (!editor || editor.isDestroyed) return;
        const at = editor.isFocused ? editor.state.selection.from : editor.state.doc.content.size - 1;
        const before = at > 1 ? editor.state.doc.textBetween(at - 1, at, '\0', '\0') : '';
        const lead = before && !/\s/.test(before) ? [{ type: 'text', text: ' ' }] : [];
        const chain = editor.chain();
        (editor.isFocused ? chain : chain.focus('end')).insertContent([...lead, { type: 'referenceChip', attrs: { label } }, { type: 'text', text: ' ' }]).run();
      },
    }),
    [editor],
  );

  return (
    <ChipContext.Provider value={chips}>
      <div className={cn('relative', className)}>
        {editor?.isEmpty && placeholder ? (
          <div aria-hidden="true" className="pointer-events-none absolute left-2 top-1.5 text-sm leading-6 text-muted-foreground/55">
            {placeholder}
          </div>
        ) : null}
        <EditorContent editor={editor} className="scrollbar-hide overflow-y-auto" style={{ minHeight: minRows * LINE_HEIGHT, maxHeight: maxRows * LINE_HEIGHT }} />
      </div>
    </ChipContext.Provider>
  );
});
