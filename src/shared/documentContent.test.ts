import { documentReviewSchema, reviewDocumentEdit } from './documentReview';
import { describe, expect, it } from 'vitest';
import { applySuggestions, revertSuggestions } from '@handlewithcare/prosemirror-suggest-changes';
import { EditorState } from '@tiptap/pm/state';
import { applyDocumentEdit, createDocumentContent, documentSchema, documentSelectionBetween, documentSelectionIntact, documentSelectionSpans, documentEditWithinSelection, documentBlocks, parseDocumentContent } from './documentContent';

function fixture() {
  return createDocumentContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '项目预计十月上线。' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '这段必须保留', marks: [{ type: 'bold' }] }] },
  ] });
}

describe('document operations and review', () => {
  it('keeps stable identities and limits a rewrite to its selected range', () => {
    const base = fixture();
    const block = documentBlocks(base)[0];
    const result = applyDocumentEdit(base, { op: 'replaceText', blockId: block.id, start: 4, end: 6, text: '十一月' }, { blockId: block.id, start: 4, end: 6 });
    expect(documentBlocks(result)[0]).toMatchObject({ id: block.id, text: '项目预计十一月上线。' });
    expect(result.doc.content?.[1]).toEqual(base.doc.content?.[1]);
    expect(parseDocumentContent(JSON.stringify(result))).toEqual(result);
    expect(() => applyDocumentEdit(base, { op: 'deleteBlock', blockId: block.id }, { blockId: block.id, start: 4, end: 6 })).toThrow('超出所选内容');
    expect(documentEditWithinSelection({ op: 'replaceText', blockId: block.id, start: 4, end: 5, text: 'x' }, { blockId: block.id, start: 4, end: 6 })).toBe(true);
    expect(documentEditWithinSelection({ op: 'replaceText', blockId: 'other', start: 4, end: 5, text: 'x' }, { blockId: block.id, start: 4, end: 6 })).toBe(false);
  });
  it('reuses the suggestion engine so an inline edit can be accepted or rejected', () => {
    const base = fixture();
    const edit = { op: 'replaceText' as const, blockId: documentBlocks(base)[0].id, start: 4, end: 6, text: '十一月' };
    const preview = reviewDocumentEdit(base, edit, 'proposal-one');
    let state = EditorState.create({ schema: documentReviewSchema, doc: documentReviewSchema.nodeFromJSON(preview) });
    applySuggestions(state, (tr) => { state = state.apply(tr); });
    expect(state.doc.textContent).toContain('十一月');
    state = EditorState.create({ schema: documentReviewSchema, doc: documentReviewSchema.nodeFromJSON(preview) });
    revertSuggestions(state, (tr) => { state = state.apply(tr); });
    expect(state.doc.textContent).toBe('项目预计十月上线。这段必须保留');
    expect(JSON.stringify(preview)).toContain('proposal-one');
  });
  it('rejects stale targets and unsupported executable attributes', () => {
    expect(() => applyDocumentEdit(fixture(), { op: 'deleteBlock', blockId: 'missing' })).toThrow('已变化');
    expect(() => createDocumentContent({ type: 'doc', content: [{ type: 'image', attrs: { src: 'file:///private.txt' } }] })).toThrow('图片');
    expect(() => createDocumentContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] })).toThrow('链接');
  });
});

describe('cross-paragraph selection', () => {
  const doc3 = () => createDocumentContent({ type: 'doc', content: ['甲乙丙丁', '戊己庚辛', '壬癸子丑'].map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
  it('is one range with a tail, and stays intact until its text moves', () => {
    const content = doc3();
    const node = documentSchema.nodeFromJSON(content.doc);
    const [a, b, c] = documentBlocks(content);
    const third = node.child(0).nodeSize + node.child(1).nodeSize;
    const range = documentSelectionBetween(node, 1 + 2, third + 1 + 2)!;
    expect(range).toEqual({ blockId: a.id, start: 2, end: 4, text: '丙丁\n戊己庚辛\n壬癸', tail: { blockId: c.id, end: 2 } });
    expect(documentSelectionBetween(node, 1 + 1, 1 + 3)).toEqual({ blockId: a.id, start: 1, end: 3, text: '乙丙' });
    expect(documentSelectionBetween(node, 1, 1)).toBeUndefined();
    expect(documentSelectionIntact(node, range)).toBe(true);
    const edited = applyDocumentEdit(content, { op: 'replaceText', blockId: b.id, start: 0, end: 1, text: '乙' });
    expect(documentSelectionIntact(documentSchema.nodeFromJSON(edited.doc), range)).toBe(false);
    expect(documentSelectionSpans(node, range)!.map((s) => [s.start, s.end, s.whole])).toEqual([[2, 4, false], [0, 4, true], [0, 2, false]]);
  });
  it('permits whole-block rewrites only for blocks the range covers entirely', () => {
    const content = doc3();
    const node = documentSchema.nodeFromJSON(content.doc);
    const [a, b, c] = documentBlocks(content);
    const third = node.child(0).nodeSize + node.child(1).nodeSize;
    const range = documentSelectionBetween(node, 1 + 2, third + 1 + 2)!;
    expect(documentEditWithinSelection({ op: 'deleteBlock', blockId: b.id }, range, node)).toBe(true);
    expect(documentEditWithinSelection({ op: 'deleteBlock', blockId: a.id }, range, node)).toBe(false);
    expect(documentEditWithinSelection({ op: 'replaceText', blockId: c.id, start: 0, end: 2, text: 'x' }, range, node)).toBe(true);
    expect(documentEditWithinSelection({ op: 'replaceText', blockId: c.id, start: 1, end: 3, text: 'x' }, range, node)).toBe(false);
    expect(documentEditWithinSelection({ op: 'insertBlocks', afterId: b.id, nodes: [] }, range, node)).toBe(true);
    // A single-block range still allows nothing but text inside itself.
    const single = documentSelectionBetween(node, 2, 4)!;
    expect(documentEditWithinSelection({ op: 'deleteBlock', blockId: a.id }, single, node)).toBe(false);
  });
});
