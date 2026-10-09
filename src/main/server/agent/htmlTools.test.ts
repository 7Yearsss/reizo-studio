import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { createHtmlTools, htmlReviewAdapter } from './htmlTools';
import { applyHtmlEdits } from '../../../shared/htmlContent';
import { parseHtmlReferences, serializeHtmlReference, splitHtmlContext, wrapHtmlContext } from '../../../shared/htmlReferences';
import { createArtifactsRouter } from '../routes/artifacts';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => { handles.splice(0).forEach((db) => db.close()); });
async function fixture() {
  const db = openDb(':memory:'); handles.push(db); const root = mkdtempSync(path.join(tmpdir(), 'html-review-'));
  const artifacts = createArtifactStore(db, root); const reviews = createArtifactReviewStore(db, artifacts, root, { html: htmlReviewAdapter });
  const content = '<h1>Original</h1>\n<p>Keep this</p>\n<footer>2026</footer>';
  const artifact = await artifacts.create({ sessionId: 'html-session', kind: 'html', name: 'index.html', source: 'manual', content });
  const tools = createHtmlTools({ artifacts, reviews, sessionId: artifact.sessionId });
  const call = (name: keyof typeof tools, input: unknown) => (tools[name].execute as unknown as (args: unknown, opts: unknown) => Promise<Record<string, unknown>>)(input, {});
  return { artifacts, reviews, artifact, tools, call };
}
it('requires unique non-overlapping replacements and keeps exact untouched source bytes', () => {
  expect(() => applyHtmlEdits('<p>x</p><p>x</p>', [{ oldText: 'x', newText: 'y' }])).toThrow('唯一');
  expect(() => applyHtmlEdits('abcdef', [{ oldText: 'abc', newText: '1' }, { oldText: 'bcd', newText: '2' }])).toThrow('重叠');
  expect(() => applyHtmlEdits('abcdef', [{ oldText: 'abc', newText: '1' }], { start: 1, end: 5 })).toThrow('选区');
  expect(applyHtmlEdits('abcdef', [{ oldText: 'ab', newText: '1' }, { oldText: 'ef', newText: '2' }], [{ start: 0, end: 2 }, { start: 4, end: 6 }])).toBe('1cd2');
  expect(() => applyHtmlEdits('abcdef', [{ oldText: 'ab', newText: '1' }, { oldText: 'cd', newText: '2' }], [{ start: 0, end: 2 }, { start: 4, end: 6 }])).toThrow('选区');
  expect(applyHtmlEdits('<style>  x\r\n</style>\n<h1>old</h1>', [{ oldText: 'old', newText: 'new' }])).toBe('<style>  x\r\n</style>\n<h1>new</h1>');
});
it('proposes without writing and supports partial accept plus reject across persisted versions', async () => {
  const f = await fixture();
  const proposed = await f.call('propose_html_edits', { artifactId: f.artifact.id, expectedVersion: 1, edits: [{ oldText: 'Original', newText: 'Updated' }, { oldText: '2026', newText: '2027' }] });
  expect(proposed.ok).toBe(true); expect((await f.artifacts.get(f.artifact.id))?.content).toBe(f.artifact.content);
  const review = f.reviews.get(String(proposed.reviewId))!;
  const accepted = await f.reviews.decide({ id: review.id, sessionId: f.artifact.sessionId, expectedReviewVersion: 1, decision: 'accept', changeIds: [review.changes[0].id] });
  const rejected = await f.reviews.decide({ id: review.id, sessionId: f.artifact.sessionId, expectedReviewVersion: accepted.reviewVersion, decision: 'reject', changeIds: [review.changes[1].id] });
  expect(rejected.status).toBe('partial');
  expect((await f.artifacts.get(f.artifact.id))?.content).toBe('<h1>Updated</h1>\n<p>Keep this</p>\n<footer>2026</footer>');
  await expect(f.artifacts.addVersion(f.artifact.id, { content: 'overwrite', origin: { surface: 'chat' } })).rejects.toThrow('待审核');
});
it('rejects stale suggestions, foreign reads, and restores using a checked current version', async () => {
  const f = await fixture();
  const foreign = await f.artifacts.create({ sessionId: 'another-session', kind: 'html', name: 'private.html', source: 'manual', content: '<p>private</p>' });
  expect((await f.call('read_html', { artifactId: foreign.id })).ok).toBe(false);
  await f.artifacts.addVersion(f.artifact.id, { expectedVersion: 1, content: '<p>Manual update</p>', origin: { surface: 'manual_edit' } });
  expect((await f.call('propose_html_edits', { artifactId: f.artifact.id, expectedVersion: 1, edits: [{ oldText: 'Manual', newText: 'AI' }] })).ok).toBe(false);
  const router = createArtifactsRouter(f.artifacts);
  const raw = await router.request(`/${f.artifact.id}/raw`);
  expect(raw.headers.get('content-disposition')).toContain('attachment');
  expect(raw.headers.get('content-security-policy')).toContain('sandbox');
  const restore = (expectedVersion: number) => router.request(`/${f.artifact.id}/restore/1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion }) });
  expect((await restore(1)).status).toBe(409); expect((await restore(2)).status).toBe(200);
  const restored = (await f.artifacts.get(f.artifact.id))!;
  expect(restored.version).toBe(3); expect(restored.content).toBe(f.artifact.content);
});
it('binds edits to the current selected source range and preserves references in chat history', async () => {
  const f = await fixture();
  const ref = { artifactId: f.artifact.id, name: 'index.html', version: 1, selection: { start: 4, end: 12, text: 'Original' } };
  const tools = createHtmlTools({ artifacts: f.artifacts, reviews: f.reviews, sessionId: f.artifact.sessionId, getReferences: () => [ref] });
  const propose = tools.propose_html_edits.execute as unknown as (input: unknown, options: unknown) => Promise<{ ok: boolean }>;
  expect((await propose({ artifactId: f.artifact.id, expectedVersion: 1, edits: [{ oldText: '2026', newText: '2027' }] }, {})).ok).toBe(false);
  expect((await propose({ artifactId: f.artifact.id, expectedVersion: 1, edits: [{ oldText: 'Original', newText: 'New' }] }, {})).ok).toBe(true);
  expect(parseHtmlReferences([serializeHtmlReference(ref), 'file.txt']).rest).toEqual(['file.txt']);
  expect(splitHtmlContext(`Edit this\n\n${wrapHtmlContext([ref])}`)).toEqual({ text: 'Edit this', refs: [ref] });
});
it('refreshes remaining line locations after an earlier suggestion inserts lines', async () => {
  const f = await fixture();
  const review = await f.reviews.create({ artifactId: f.artifact.id, sessionId: f.artifact.sessionId, expectedVersion: 1, origin: { surface: 'chat' }, operations: [{ oldText: 'Original', newText: 'Original\nSubtitle' }, { oldText: '2026', newText: '2027' }] });
  expect(review.changes[1].label).toContain('第 3 行');
  const next = await f.reviews.decide({ id: review.id, sessionId: f.artifact.sessionId, expectedReviewVersion: 1, decision: 'accept', changeIds: [review.changes[0].id] });
  expect(next.changes[1].label).toContain('第 4 行');
});
