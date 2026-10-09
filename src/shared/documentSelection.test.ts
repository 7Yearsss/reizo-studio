import { describe, expect, it } from 'vitest';
import { documentFromHtml } from '../main/server/agent/documentIO';
import { documentBlocks, documentSchema, documentSelectionIntact } from './documentContent';

describe('documentSelectionIntact', () => {
  it('survives edits to other blocks but not to the selected one', () => {
    const content = documentFromHtml('<p>第一段</p><p>请把这句改正式</p>');
    const [first, second] = documentBlocks(content);
    const selection = { blockId: second.id, start: 2, end: 4, text: '这句' };
    expect(documentSelectionIntact(documentSchema.nodeFromJSON(content.doc), selection)).toBe(true);

    const editOther = structuredClone(content.doc);
    editOther.content![0].content![0].text = '第一段被改了很多很多';
    expect(first.text).toBe('第一段');
    expect(documentSelectionIntact(documentSchema.nodeFromJSON(editOther), selection)).toBe(true);

    const editSame = structuredClone(content.doc);
    editSame.content![1].content![0].text = '请务必把这句改正式'; // insertion shifts the range
    expect(documentSelectionIntact(documentSchema.nodeFromJSON(editSame), selection)).toBe(false);
  });

  it('fails on shifted offsets, different text, a missing block, or unknown text', () => {
    const content = documentFromHtml('<p>请把这句改正式</p>');
    const doc = documentSchema.nodeFromJSON(content.doc);
    const selection = { blockId: documentBlocks(content)[0].id, start: 2, end: 4, text: '这句' };
    expect(documentSelectionIntact(doc, selection)).toBe(true);
    expect(documentSelectionIntact(doc, { ...selection, start: 3, end: 5 })).toBe(false);
    expect(documentSelectionIntact(doc, { ...selection, text: '那句' })).toBe(false);
    expect(documentSelectionIntact(doc, { ...selection, end: 999 })).toBe(false);
    expect(documentSelectionIntact(doc, { ...selection, text: undefined })).toBe(false);
    expect(documentSelectionIntact(doc, { ...selection, blockId: 'missing' })).toBe(false);
  });
});
