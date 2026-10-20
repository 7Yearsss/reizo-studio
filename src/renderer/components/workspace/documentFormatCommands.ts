import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';

/** Run-level and paragraph-level formatting commands for the document toolbar. */

export interface RunStylePatch { font?: string | null; size?: number | null; color?: string | null; highlight?: string | null }
export interface BlockPatch { textAlign?: 'left' | 'center' | 'right' | 'justify' | null; indentFirst?: number | null; indentLeft?: number | null; lineSpacing?: number | null; lineExact?: number | null }

type RunAttrs = { font: string | null; size: number | null; color: string | null; highlight: string | null; vert: string | null };
const EMPTY_RUN: RunAttrs = { font: null, size: null, color: null, highlight: null, vert: null };

const runAttrsOf = (marks: readonly Mark[]): RunAttrs => ({ ...EMPTY_RUN, ...((marks.find((m) => m.type.name === 'runStyle')?.attrs ?? {}) as Partial<RunAttrs>) });

/** Merge `patch` into the run style of the selection (each text run keeps the parts of its style the patch does not name). */
export function setRunStyle(editor: Editor, patch: RunStylePatch): void {
  const { state, view } = editor;
  const type = state.schema.marks.runStyle;
  const { from, to, empty, $from } = state.selection;
  const tr = state.tr;
  const merge = (previous: RunAttrs) => {
    const next = { ...previous, ...patch };
    return Object.values(next).some((v) => v !== null && v !== undefined) ? type.create(next) : null;
  };
  if (empty) {
    const next = merge(runAttrsOf(state.storedMarks ?? $from.marks()));
    if (next) tr.addStoredMark(next); else tr.removeStoredMark(type);
  } else {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const a = Math.max(from, pos);
      const b = Math.min(to, pos + node.nodeSize);
      const next = merge(runAttrsOf(node.marks));
      if (next) tr.addMark(a, b, next); else tr.removeMark(a, b, type);
    });
  }
  view.dispatch(tr);
  view.focus();
}

/** Set paragraph attributes on every paragraph or heading the selection touches. */
export function setBlockAttrs(editor: Editor, patch: BlockPatch): void {
  const { state, view } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
  });
  view.dispatch(tr);
  view.focus();
}

export interface FormatState {
  font: string | null;
  size: number | null;
  color: string | null;
  highlight: string | null;
  align: 'left' | 'center' | 'right' | 'justify';
  indentFirst: number;
  indentLeft: number;
  lineSpacing: number | null;
  lineExact: number | null;
}

/** What the toolbar shows for the current selection (the caret's own style when nothing is selected). */
export function readFormatState(editor: Editor): FormatState {
  const { state } = editor;
  const { $from, from, to, empty } = state.selection;
  const run = runAttrsOf(empty ? state.storedMarks ?? $from.marks() : state.doc.resolve(Math.min(from + 1, to)).marks());
  const block = $from.parent;
  const attrs = (block.type.name === 'paragraph' || block.type.name === 'heading' ? block.attrs : {}) as Record<string, unknown>;
  const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);
  return {
    font: run.font, size: run.size, color: run.color, highlight: run.highlight,
    align: (['center', 'right', 'justify'].includes(String(attrs.textAlign)) ? attrs.textAlign : 'left') as FormatState['align'],
    indentFirst: num(attrs.indentFirst), indentLeft: num(attrs.indentLeft),
    lineSpacing: attrs.lineSpacing ? num(attrs.lineSpacing) : null, lineExact: attrs.lineExact ? num(attrs.lineExact) : null,
  };
}
