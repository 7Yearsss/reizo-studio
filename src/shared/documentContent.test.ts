import { documentReviewSchema, reviewDocumentEdit } from './documentReview';
import { describe, expect, it } from 'vitest';
import { applySuggestions, revertSuggestions } from '@handlewithcare/prosemirror-suggest-changes';
import { EditorState } from '@tiptap/pm/state';
import { applyDocumentEdit, createDocumentContent, documentBlocks, parseDocumentContent } from './documentContent';

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
