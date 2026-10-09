import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { documentReviewAdapter } from '../agent/documentReviewAdapter';
import { createDocumentTools } from '../agent/documentTools';
import { documentFromHtml, exportDocx, importDocx } from '../agent/documentIO';
import { documentBlocks, parseDocumentContent } from '../../../shared/documentContent';
import { createDocumentsRouter } from './documents';
import { createArtifactsRouter } from './artifacts';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => { handles.splice(0).forEach((db) => db.close()); });
async function setup() {
  const db = openDb(':memory:'); handles.push(db);
  const root = mkdtempSync(path.join(tmpdir(), 'doc-review-test-'));
  const artifacts = createArtifactStore(db, root); const sessions = createSqliteSessionStore(db);
  const session = await sessions.create('Doc review');
  const reviews = createArtifactReviewStore(db, artifacts, root, { doc: documentReviewAdapter });
  const content = documentFromHtml('<h2>计划</h2><p>原始段落</p><p><strong>保持不变</strong></p>');
  const artifact = await artifacts.create({ sessionId: session.id, name: '方案', kind: 'doc', source: 'manual', content: JSON.stringify(content) });
  const router = createDocumentsRouter(artifacts, sessions, reviews);
  return { artifacts, sessions, session, reviews, content, artifact, router };
}

describe('document workspace boundary', () => {
  it('roundtrips formatted paragraphs and tables through real DOCX converters', async () => {
    const source = documentFromHtml('<h1>标题</h1><p>保留<strong>粗体</strong></p><table><tr><th>名称</th><th>数量</th></tr><tr><td>样例</td><td>2</td></tr></table>');
    const bytes = await exportDocx(source);
    expect(bytes[0]).toBe(80); expect(bytes[1]).toBe(75);
    const result = await importDocx(Buffer.from(bytes));
    expect(JSON.stringify(result.doc)).toContain('粗体');
    expect(JSON.stringify(result.doc)).toContain('"bold"');
    expect(documentBlocks(result).some((b) => b.type === 'table')).toBe(true);
    expect(result.importWarnings?.length).toBeGreaterThan(0);
  });
  it('keeps proposals separate, enforces selected range, and commits only by user decision', async () => {
    const f = await setup();
    const block = documentBlocks(f.content).find((b) => b.text === '原始段落')!;
    const tools = createDocumentTools({ sessionId: f.session.id, artifacts: f.artifacts, reviews: f.reviews, references: [{ artifactId: f.artifact.id, name: '方案', version: 1, selection: { blockId: block.id, start: 0, end: 2 } }] });
    const call = (name: keyof typeof tools, input: unknown) => (tools[name].execute as unknown as (input: unknown, options: unknown) => Promise<Record<string, unknown>>)(input, { toolCallId: 'test', messages: [] });
    const base = { artifactId: f.artifact.id, expectedVersion: 1 };
    expect((await call('propose_document_edits', { ...base, operations: [{ op: 'replaceText', blockId: block.id, start: 0, end: 4, text: '越界' }] })).ok).toBe(false);
    const proposed = await call('propose_document_edits', { ...base, operations: [{ op: 'replaceText', blockId: block.id, start: 0, end: 2, text: '新的' }] });
    expect(proposed.ok).toBe(true);
    expect((await f.artifacts.get(f.artifact.id))?.content).toBe(f.artifact.content);
    expect(Object.keys(tools).some((key) => /accept|decide/.test(key))).toBe(false);
    const review = f.reviews.get(String(proposed.reviewId))!;
    const response = await f.router.request(`/artifacts/${f.artifact.id}/reviews/${review.id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedReviewVersion: 1, changeIds: [review.changes[0].id], decision: 'accept' }) });
    expect(response.status).toBe(200);
    const updated = (await f.artifacts.get(f.artifact.id))!;
    expect(updated.version).toBe(2);
    expect(updated.content).toContain('新的段落'); expect(updated.content).toContain('保持不变');
    expect(JSON.stringify(parseDocumentContent(updated.content)?.doc)).toContain('"bold"');
  });
  it('accepts edits inside any of several picked ranges and rejects edits outside all of them', async () => {
    const f = await setup();
    const [first, second] = ['原始段落', '保持不变'].map((text) => documentBlocks(f.content).find((b) => b.text === text)!);
    const tools = createDocumentTools({ sessionId: f.session.id, artifacts: f.artifacts, reviews: f.reviews, references: [
      { artifactId: f.artifact.id, name: '方案', version: 1, label: 1, selection: { blockId: first.id, start: 0, end: 2, text: '原始' } },
      { artifactId: f.artifact.id, name: '方案', version: 1, label: 2, selection: { blockId: second.id, start: 2, end: 4, text: '不变' } },
    ] });
    const call = (name: keyof typeof tools, input: unknown) => (tools[name].execute as unknown as (input: unknown, options: unknown) => Promise<Record<string, unknown>>)(input, { toolCallId: 'test', messages: [] });
    const base = { artifactId: f.artifact.id, expectedVersion: 1 };
    expect((await call('read_document', { artifactId: f.artifact.id })).selections).toMatchObject([{ blockId: first.id, label: 1 }, { blockId: second.id, label: 2 }]);
    expect((await call('propose_document_edits', { ...base, operations: [{ op: 'replaceText', blockId: first.id, start: 0, end: 2, text: '新的' }, { op: 'replaceText', blockId: second.id, start: 2, end: 4, text: '更新' }] })).ok).toBe(true);
    expect((await call('propose_document_edits', { ...base, operations: [{ op: 'replaceText', blockId: first.id, start: 0, end: 2, text: '新的' }, { op: 'replaceText', blockId: second.id, start: 0, end: 2, text: '越界' }] })).ok).toBe(false);
  });
  it('scopes tools and review routes, rejects stale saves, and preserves imported original', async () => {
    const f = await setup();
    const toolset = createDocumentTools({ sessionId: 'other', artifacts: f.artifacts, reviews: f.reviews });
    const read = await (toolset.read_document.execute as Function)({ artifactId: f.artifact.id }, {});
    expect(read.ok).toBe(false);
    const saveRouter = createArtifactsRouter(f.artifacts);
    const request = (expectedVersion?: number) => saveRouter.request(`/${f.artifact.id}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion, content: f.artifact.content }) });
    expect((await request()).status).toBe(400);
    expect((await request(1)).status).toBe(200);
    expect((await request(1)).status).toBe(409);
    await expect(f.artifacts.addVersion(f.artifact.id, { content: f.artifact.content, origin: { surface: 'chat' } })).rejects.toThrow('待审核');
    const bytes = await exportDocx(f.content);
    const imported = await f.router.request(`/sessions/${f.session.id}/documents/import?name=test.docx`, { method: 'POST', body: new Uint8Array(bytes) });
    expect(imported.status).toBe(201);
    const importedDoc = (await imported.json()).artifact;
    const originalId = parseDocumentContent(importedDoc.content)?.originalArtifactId;
    expect(originalId).toBeTruthy();
    expect((await f.artifacts.get(originalId!))?.mimeType).toContain('wordprocessingml');
    const exported = await f.router.request(`/artifacts/${importedDoc.id}/document.docx`);
    expect(exported.status).toBe(200); expect(exported.headers.get('content-disposition')).toContain('attachment');
  });
  it('assigns new identities to AI-supplied blocks instead of colliding with existing IDs', async () => {
    const f = await setup();
    const original = f.content.doc.content![0];
    const proposal = await f.reviews.create({ artifactId: f.artifact.id, sessionId: f.session.id, expectedVersion: 1, origin: { surface: 'chat' }, operations: [{ op: 'insertBlocks', afterId: null, nodes: [original] }] });
    const next = parseDocumentContent(proposal.candidateContent)!;
    const ids = documentBlocks(next).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(original.attrs!.id);
  });
});

describe('word-level review', () => {
  it('splits a rewrite into exact hunks, accepts them independently and keeps later offsets valid', async () => {
    const f = await setup();
    const content = documentFromHtml('<p>甲方应在三十日内付款，乙方应在十日内交付。</p>');
    const artifact = await f.artifacts.create({ sessionId: f.session.id, name: '合同', kind: 'doc', source: 'manual', content: JSON.stringify(content) });
    const block = documentBlocks(content)[0];
    const review = await f.reviews.create({ artifactId: artifact.id, sessionId: f.session.id, expectedVersion: 1, origin: { surface: 'chat' },
      operations: [{ op: 'replaceText', blockId: block.id, start: 0, end: block.text.length, text: '甲方应在十五日内付款，乙方应在七日内交付。' }] });
    expect(review.changes.length).toBe(2);
    expect(review.changes[0].label).toContain('→');
    // Accept the later hunk first, then the earlier one: offsets shift between the two decisions.
    const second = await f.reviews.decide({ id: review.id, sessionId: f.session.id, expectedReviewVersion: 1, changeIds: [review.changes[1].id], decision: 'accept' });
    const rebased = second.changes[0].operation as { start: number };
    expect(rebased.start).toBe((review.changes[0].operation as { start: number }).start);
    const done = await f.reviews.decide({ id: review.id, sessionId: f.session.id, expectedReviewVersion: second.reviewVersion, changeIds: [review.changes[0].id], decision: 'accept' });
    expect(done.status).toBe('accepted');
    expect(documentBlocks(parseDocumentContent((await f.artifacts.get(artifact.id))!.content)!)[0].text).toBe('甲方应在十五日内付款，乙方应在七日内交付。');
  });
});
