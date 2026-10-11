import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { createDocumentContent, documentSchema } from '../../../shared/documentContent';
import { docSearchKey, docSearchPlugin, findMatches } from './docSearch';

const doc = () => documentSchema.nodeFromJSON(createDocumentContent({ type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: '预算在' }, { type: 'text', text: '预算', marks: [{ type: 'bold' }] }, { type: 'text', text: '之内，Budget 与 budget。' }] },
  { type: 'paragraph', content: [{ type: 'text', text: '第二段无关。' }] },
  { type: 'paragraph', content: [{ type: 'text', text: '预' }] },
] }).doc);

describe('findMatches', () => {
  it('finds a term across formatting runs, per paragraph, with exact positions', () => {
    const d = doc();
    const found = findMatches(d, '预算', false);
    expect(found).toHaveLength(2);
    expect(found.map((m) => d.textBetween(m.from, m.to))).toEqual(['预算', '预算']);
    // A match never spans two paragraphs: "算第" would only exist if blocks were joined.
    expect(findMatches(d, '算第', false)).toEqual([]);
  });
  it('honours case sensitivity and ignores empty queries', () => {
    const d = doc();
    expect(findMatches(d, 'budget', false)).toHaveLength(2);
    expect(findMatches(d, 'budget', true)).toHaveLength(1);
    expect(findMatches(d, '', false)).toEqual([]);
  });
});

describe('docSearchPlugin', () => {
  it('tracks the current match and recomputes when the document changes', () => {
    const state = EditorState.create({ doc: doc(), schema: documentSchema, plugins: [docSearchPlugin()] });
    const searched = state.apply(state.tr.setMeta(docSearchKey, { query: '预算', current: 1 }));
    expect(docSearchKey.getState(searched)).toMatchObject({ query: '预算', current: 1 });
    expect(docSearchKey.getState(searched)!.matches).toHaveLength(2);
    const first = docSearchKey.getState(searched)!.matches[0];
    const replaced = searched.apply(searched.tr.insertText('', first.from, first.to));
    expect(docSearchKey.getState(replaced)!.matches).toHaveLength(1);
    expect(docSearchKey.getState(replaced)!.current).toBe(0);
  });
});
