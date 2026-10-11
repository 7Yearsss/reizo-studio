import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Keeps the range being rewritten visibly selected while the focus is in the instruction box. */
export const inlineEditMarksKey = new PluginKey<DecorationSet>('reizoInlineEditMarks');

export function inlineEditMarksPlugin() {
  return new Plugin<DecorationSet>({
    key: inlineEditMarksKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => (tr.getMeta(inlineEditMarksKey) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc),
    },
    props: { decorations: (state) => inlineEditMarksKey.getState(state) },
  });
}

export function inlineEditDecorations(doc: ProseMirrorNode, range: { from: number; to: number } | null): DecorationSet {
  if (!range || range.to <= range.from || range.to > doc.content.size) return DecorationSet.empty;
  return DecorationSet.create(doc, [Decoration.inline(range.from, range.to, { class: 'doc-edit-target' })]);
}
