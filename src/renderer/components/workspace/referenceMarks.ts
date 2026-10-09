import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { DocumentSelection } from '../../../shared/documentContent';

export interface LabelledRange { selection: DocumentSelection; label: number }

/** Marks the ranges already handed to the chat, each with the number its chip carries in the composer. */
export const referenceMarksKey = new PluginKey<DecorationSet>('reizoReferenceMarks');

export function referenceMarksPlugin() {
  return new Plugin<DecorationSet>({
    key: referenceMarksKey,
    state: {
      init: () => DecorationSet.empty,
      // A fresh set arrives as meta whenever the picked ranges change; between those, follow the user's typing.
      apply: (tr, set) => (tr.getMeta(referenceMarksKey) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc),
    },
    props: { decorations: (state) => referenceMarksKey.getState(state) },
  });
}

function badge(label: number): HTMLElement {
  const el = document.createElement('span');
  el.className = 'doc-ref-label'; el.textContent = String(label); el.contentEditable = 'false';
  el.setAttribute('aria-label', `引用 ${label}`);
  return el;
}

export function referenceDecorations(doc: ProseMirrorNode, ranges: LabelledRange[]): DecorationSet {
  const blocks = new Map<string, { pos: number; size: number }>();
  doc.descendants((node, pos) => { if (node.isTextblock && typeof node.attrs.id === 'string') blocks.set(node.attrs.id, { pos, size: node.content.size }); });
  const decorations: Decoration[] = [];
  for (const { selection, label } of ranges) {
    const block = blocks.get(selection.blockId);
    if (!block || selection.end > block.size) continue;
    const from = block.pos + 1 + selection.start; const to = block.pos + 1 + selection.end;
    decorations.push(Decoration.inline(from, to, { class: 'doc-ref-range' }), Decoration.widget(from, () => badge(label), { side: -1, key: `ref-${label}`, ignoreSelection: true }));
  }
  return DecorationSet.create(doc, decorations);
}
