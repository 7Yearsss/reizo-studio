import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface SearchMatch { from: number; to: number }
export interface SearchState { query: string; caseSensitive: boolean; matches: SearchMatch[]; current: number }

export const docSearchKey = new PluginKey<SearchState>('reizoDocSearch');

const EMPTY: SearchState = { query: '', caseSensitive: false, matches: [], current: -1 };
const MAX_MATCHES = 2000;

/** Every occurrence of `query` inside a single text block (matches never span paragraphs). */
export function findMatches(doc: ProseMirrorNode, query: string, caseSensitive: boolean): SearchMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    let text = '';
    const positions: number[] = [];
    node.descendants((child, offset) => {
      if (child.isText) for (let i = 0; i < (child.text ?? '').length; i++) { text += child.text![i]; positions.push(pos + 1 + offset + i); }
      else if (child.isLeaf) { text += '\n'; positions.push(pos + 1 + offset); }
    });
    const haystack = caseSensitive ? text : text.toLowerCase();
    for (let at = haystack.indexOf(needle); at >= 0 && matches.length < MAX_MATCHES; at = haystack.indexOf(needle, at + needle.length)) {
      matches.push({ from: positions[at], to: positions[at + needle.length - 1] + 1 });
    }
    return false;
  });
  return matches;
}

export interface SearchMeta { query?: string; caseSensitive?: boolean; current?: number }

/** Highlights every match of the find bar's query, with the current one stronger; recomputes as the document changes. */
export function docSearchPlugin() {
  return new Plugin<SearchState>({
    key: docSearchKey,
    state: {
      init: () => EMPTY,
      apply(tr, previous, _old, next) {
        const meta = tr.getMeta(docSearchKey) as SearchMeta | undefined;
        if (!meta && !tr.docChanged) return previous;
        const query = meta?.query ?? previous.query;
        const caseSensitive = meta?.caseSensitive ?? previous.caseSensitive;
        const matches = findMatches(next.doc, query, caseSensitive);
        const wanted = meta?.current ?? previous.current;
        return { query, caseSensitive, matches, current: matches.length ? Math.min(Math.max(wanted, 0), matches.length - 1) : -1 };
      },
    },
    props: {
      decorations(state) {
        const search = docSearchKey.getState(state);
        if (!search?.matches.length) return DecorationSet.empty;
        return DecorationSet.create(state.doc, search.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === search.current ? 'doc-find-current' : 'doc-find-match' })));
      },
    },
  });
}
