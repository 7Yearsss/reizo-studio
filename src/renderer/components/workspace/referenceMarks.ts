import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { documentSelectionSpans, type DocumentSelection } from '../../../shared/documentContent';

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
  const decorations: Decoration[] = [];
  for (const { selection, label } of ranges) {
    const spans = documentSelectionSpans(doc, selection);
    if (!spans) continue;
    // One range, one badge: the number sits at the start; every covered block's stretch is tinted.
    spans.forEach((span, index) => {
      const from = span.pos + 1 + span.start;
      const to = span.pos + 1 + span.end;
      if (to > from) decorations.push(Decoration.inline(from, to, { class: 'doc-ref-range' }));
      if (index === 0) decorations.push(Decoration.widget(from, () => badge(label), { side: -1, key: `ref-${label}`, ignoreSelection: true }));
    });
  }
  return DecorationSet.create(doc, decorations);
}
