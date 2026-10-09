import { beforeEach, describe, expect, it } from 'vitest';
import { parseDocumentReferences } from '../../shared/documentReferences';
import { parseHtmlReferences } from '../../shared/htmlReferences';
import { parsePresentationReferences } from '../../shared/presentationReferences';
import { addDocumentReference, documentMentions, dropDocumentSelection, reconcileDocumentSelection, referenceDocument, removeDocumentReference, syncDocumentReferenceVersion } from './documentWorkspace';
import { addHtmlReference, dropHtmlSelection, htmlMentions, referenceHtml } from './htmlWorkspace';
import { dropPresentationScope, presentationMentions, referencePresentation } from './presentationWorkspace';

const S = 's1';
const sent = () => parseDocumentReferences(documentMentions(S)).refs[0];
const picked = { blockId: 'b1', start: 2, end: 4, text: '这句' };

describe('document reference lifecycle', () => {
  beforeEach(() => referenceDocument(S));

  it('spending a selection keeps the document as a whole-document reference', () => {
    referenceDocument(S, { artifactId: 'd1', name: '合同', version: 3, selection: picked });
    dropDocumentSelection(S);
    expect(sent()).toEqual({ artifactId: 'd1', name: '合同', version: 3, selection: undefined });
    dropDocumentSelection(S); // idempotent, still referenced
    expect(sent().artifactId).toBe('d1');
  });

  it('does nothing when no document is referenced', () => {
    dropDocumentSelection(S);
    expect(documentMentions(S)).toEqual([]);
  });

  it('an edit keeps the selection while its text is intact, and demotes it once it moved', () => {
    referenceDocument(S, { artifactId: 'd1', name: '合同', version: 3, selection: picked });
    reconcileDocumentSelection(S, 'd1', () => true);
    expect(sent().selection).toMatchObject({ blockId: 'b1', start: 2, end: 4 });
    reconcileDocumentSelection(S, 'd1', () => false);
    expect(sent()).toMatchObject({ artifactId: 'd1', name: '合同' });
    expect(sent().selection).toBeUndefined();
  });

  it('typing in a different document never touches this reference', () => {
    referenceDocument(S, { artifactId: 'd1', name: '合同', version: 3, selection: picked });
    reconcileDocumentSelection(S, 'other', () => false);
    expect(sent().selection).toBeDefined();
  });

  it('a whole-document reference survives edits untouched', () => {
    referenceDocument(S, { artifactId: 'd1', name: '合同', version: 3 });
    reconcileDocumentSelection(S, 'd1', () => false);
    expect(sent()).toMatchObject({ artifactId: 'd1', version: 3 });
  });

  it('collects several picked ranges as numbered references', () => {
    const all = () => parseDocumentReferences(documentMentions(S)).refs;
    addDocumentReference(S, { artifactId: 'd1', name: '合同', version: 3 });
    addDocumentReference(S, { artifactId: 'd1', name: '合同', version: 3, selection: picked });
    addDocumentReference(S, { artifactId: 'd1', name: '合同', version: 3, selection: { blockId: 'b2', start: 0, end: 3, text: '第二段' } });
    expect(all().map((r) => [r.selection?.blockId, r.label])).toEqual([['b1', 1], ['b2', 2]]); // the whole-document reference gave way
    addDocumentReference(S, { artifactId: 'd1', name: '合同', version: 3, selection: { blockId: 'b1', start: 3, end: 6, text: '句话' } });
    expect(all().map((r) => r.selection?.blockId)).toEqual(['b2', 'b1']); // an overlapping pick replaces the old one
    expect(parseDocumentReferences(documentMentions(S, 4)).refs.map((r) => r.label)).toEqual([4, 5]);
    reconcileDocumentSelection(S, 'd1', (s) => s.blockId === 'b2');
    expect(all().map((r) => r.selection?.blockId)).toEqual(['b2']);
    reconcileDocumentSelection(S, 'd1', () => false);
    expect(all()).toEqual([{ artifactId: 'd1', name: '合同', version: 3, selection: undefined }]);
    addDocumentReference(S, { artifactId: 'd1', name: '合同', version: 3, selection: picked });
    removeDocumentReference(S, 0);
    expect(documentMentions(S)).toEqual([]);
  });

  it('sending spends every range but keeps each document once', () => {
    addDocumentReference(S, { artifactId: 'd1', name: '合同', version: 3, selection: picked });
    addDocumentReference(S, { artifactId: 'd1', name: '合同', version: 3, selection: { blockId: 'b2', start: 0, end: 1, text: '第' } });
    addDocumentReference(S, { artifactId: 'd2', name: '附件', version: 1, selection: picked });
    syncDocumentReferenceVersion(S, 'd1', 4);
    dropDocumentSelection(S);
    expect(parseDocumentReferences(documentMentions(S)).refs.map((r) => [r.artifactId, r.version, r.selection])).toEqual([['d1', 4, undefined], ['d2', 1, undefined]]);
  });

  it('follows autosaves so a still-valid selection is not rejected as stale', () => {
    referenceDocument(S, { artifactId: 'd1', name: '合同', version: 3, selection: picked });
    syncDocumentReferenceVersion(S, 'd1', 4);
    expect(sent()).toMatchObject({ version: 4, selection: { blockId: 'b1' } });
    syncDocumentReferenceVersion(S, 'other', 9);
    expect(sent().version).toBe(4);
  });
});

describe('html / presentation reference lifecycle', () => {
  it('html: a sent source selection becomes a whole-page reference', () => {
    referenceHtml(S, { artifactId: 'h1', name: 'index.html', version: 2, selection: { start: 1, end: 9, text: 'x' } });
    dropHtmlSelection(S);
    const ref = parseHtmlReferences(htmlMentions(S)).refs[0];
    expect(ref).toMatchObject({ artifactId: 'h1', version: 2 });
    expect(ref.selection).toBeUndefined();
    referenceHtml(S);
  });

  it('html: ranges of the edited page are spent, other pages keep theirs', () => {
    addHtmlReference(S, { artifactId: 'h1', name: 'a.html', version: 2, selection: { start: 1, end: 3, text: 'x' } });
    addHtmlReference(S, { artifactId: 'h1', name: 'a.html', version: 2, selection: { start: 5, end: 8, text: 'y' } });
    addHtmlReference(S, { artifactId: 'h2', name: 'b.html', version: 1, selection: { start: 0, end: 2, text: 'z' } });
    expect(parseHtmlReferences(htmlMentions(S, 3)).refs.map((r) => r.label)).toEqual([3, 4, 5]);
    dropHtmlSelection(S, 'h1');
    expect(parseHtmlReferences(htmlMentions(S)).refs.map((r) => [r.artifactId, Boolean(r.selection)])).toEqual([['h1', false], ['h2', true]]);
    referenceHtml(S);
  });

  it('presentation: slide/element scope is dropped, deck identity stays', () => {
    referencePresentation(S, { artifactId: 'p1', name: '路演', version: 5, slideId: 'sl1', elementIds: ['e1'] });
    dropPresentationScope(S);
    const ref = parsePresentationReferences(presentationMentions(S)).refs[0];
    expect(ref).toMatchObject({ artifactId: 'p1', version: 5 });
    expect(ref.slideId).toBeUndefined();
    expect(ref.elementIds).toBeUndefined();
    referencePresentation(S);
  });
});
