import { describe, expect, it } from 'vitest';
import { wrapDocumentContext } from './documentReferences';
import { wrapPresentationContext } from './presentationReferences';
import { compactReferenceContext } from './referenceContext';
import { wrapSheetContext } from './sheetReferences';

describe('compactReferenceContext', () => {
  it('leaves messages without reference blocks untouched', () => {
    expect(compactReferenceContext('你好，帮我看看')).toBe('你好，帮我看看');
  });

  it('replaces bulky sheet data with a one-line identity', () => {
    const data = 'A1=x\t'.repeat(4000);
    const content = `汇总一下\n\n${wrapSheetContext([{ artifactId: 'book-1', name: '预算.xlsx', sheetName: '一月', range: 'A1:C9' }], data)}`;
    const out = compactReferenceContext(content);
    expect(out).toContain('汇总一下');
    expect(out).toContain('Excel "预算.xlsx" id=book-1 sheet="一月" range=A1:C9');
    expect(out).toContain('read_*');
    expect(out).not.toContain('A1=x');
    expect(out.length).toBeLessThan(content.length / 10);
  });

  it('keeps identity and a short selection excerpt for doc/ppt refs and drops instructions', () => {
    const long = '这是一段非常非常长的选中文字'.repeat(20);
    const content = [
      '改一下',
      wrapDocumentContext([{ artifactId: 'doc-1', name: '合同.docx', version: 2, selection: { blockId: 'b1', start: 0, end: long.length, text: long } }]),
      wrapPresentationContext([{ artifactId: 'ppt-1', name: '路演', version: 1, slideId: 's1', elementIds: ['e1', 'e2'] }]),
    ].join('\n\n');
    const out = compactReferenceContext(content);
    expect(out).toContain('Doc "合同.docx" id=doc-1 selected');
    expect(out).toContain('PPT "路演" id=ppt-1 slide=s1 elements=2');
    expect(out).not.toContain(long);
    expect(out).not.toContain('propose_document_edits');
    expect(out).not.toContain('<document-context>');
    expect(out.startsWith('改一下')).toBe(true);
  });

  it('is idempotent', () => {
    const content = `x\n\n${wrapDocumentContext([{ artifactId: 'doc-1', name: 'a', version: 1 }])}`;
    const once = compactReferenceContext(content);
    expect(compactReferenceContext(once)).toBe(once);
  });
});
