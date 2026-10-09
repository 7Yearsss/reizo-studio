import { beforeEach, describe, expect, it } from 'vitest';
import { parseDocumentReferences } from '../../shared/documentReferences';
import { parseHtmlReferences } from '../../shared/htmlReferences';
import { parsePresentationReferences } from '../../shared/presentationReferences';
import { documentMentions, dropDocumentSelection, reconcileDocumentSelection, referenceDocument, syncDocumentReferenceVersion } from './documentWorkspace';
import { dropHtmlSelection, htmlMentions, referenceHtml } from './htmlWorkspace';
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
