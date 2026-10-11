// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArtifactWithContent } from '../../../shared/artifact';
import { createDocumentContent } from '../../../shared/documentContent';
import { addDocumentReference, documentMentions, referenceDocument } from '../../state/documentWorkspace';
import { clearEditorRecovery } from '../../state/editorPersistence';
import DocumentEditor from './DocumentEditor';

const harness = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), reviews: vi.fn(), decide: vi.fn(), upsert: vi.fn() }));
vi.mock('../../api', () => ({ getArtifact: harness.get, addArtifactVersion: harness.save, listArtifactReviews: harness.reviews, decideArtifactReview: harness.decide }));
vi.mock('../../state/artifactStore', () => ({ upsertArtifact: harness.upsert }));
let root: Root; let host: HTMLDivElement;
const initial: ArtifactWithContent = { id: 'doc-editor-test', sessionId: 'doc-session', name: '方案', kind: 'doc', renderer: 'doc', status: 'complete', mimeType: 'application/vnd.reizo.document+json', source: 'manual', version: 1, versionCount: 1, byteSize: 1, createdAt: '', updatedAt: '', content: JSON.stringify(createDocumentContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep this text.' }] }] })) };
beforeEach(() => {
  vi.clearAllMocks(); referenceDocument(initial.sessionId); clearEditorRecovery(initial.id);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  harness.get.mockResolvedValue(initial); harness.reviews.mockResolvedValue([]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); referenceDocument(initial.sessionId); clearEditorRecovery(initial.id); });
it('retains a document reference without saving merely because editable mode toggled', async () => {
  await act(async () => { root.render(<DocumentEditor artifact={initial} />); });
  await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === '引用全文')!.click(); });
  expect(documentMentions(initial.sessionId)).toHaveLength(1);
  expect(decodeURIComponent(documentMentions(initial.sessionId)[0])).toContain('"version":1');
  expect(harness.save).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="文档正文"]')?.textContent).toBe('Keep this text.');
});

it('hands focus to the composer when the document is referenced', async () => {
  const focus = vi.fn();
  window.addEventListener('reizo:focus-composer', focus);
  await act(async () => { root.render(<DocumentEditor artifact={initial} />); });
  await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === '引用全文')!.click(); });
  expect((focus.mock.calls[0][0] as CustomEvent).detail).toEqual({ sessionId: initial.sessionId });
  expect(host.textContent).toContain('全文');
  window.removeEventListener('reizo:focus-composer', focus);
});

it('numbers every picked range in the page, matching the chips', async () => {
  await act(async () => { root.render(<DocumentEditor artifact={initial} />); });
  const blockId = host.querySelector('[aria-label="文档正文"] p')?.getAttribute('data-id');
  expect(blockId).toBeTruthy();
  const pick = (start: number, end: number, text: string) => addDocumentReference(initial.sessionId, { artifactId: initial.id, name: initial.name, version: 1, selection: { blockId: blockId!, start, end, text } });
  await act(async () => { pick(0, 4, 'Keep'); pick(10, 14, 'text'); });
  expect([...host.querySelectorAll('.doc-ref-label')].map((el) => el.textContent)).toEqual(['1', '2']);
  expect([...host.querySelectorAll('.doc-ref-range')].map((el) => el.textContent)).toEqual(['Keep', 'text']);
  expect(host.textContent).toContain('2 段选区');
  await act(async () => { referenceDocument(initial.sessionId); });
  expect(host.querySelectorAll('.doc-ref-label')).toHaveLength(0);
});
