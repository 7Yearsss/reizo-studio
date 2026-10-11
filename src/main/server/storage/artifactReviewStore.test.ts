import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from './artifactStore';
import { createArtifactReviewStore } from './artifactReviewStore';
import { documentReviewAdapter } from '../agent/documentReviewAdapter';
import { createDocumentContent, documentBlocks, parseDocumentContent } from '../../../shared/documentContent';

const handles: ReturnType<typeof openDb>[] = [];
async function fixture() {
  const db = openDb(':memory:'); handles.push(db);
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'reizo-review-test-'));
  const artifacts = createArtifactStore(db, dataRoot);
  const content = createDocumentContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段原文' }] }, { type: 'paragraph', content: [{ type: 'text', text: '第二段原文' }] }] });
  const artifact = await artifacts.create({ sessionId: 'session', kind: 'doc', name: '报告.docx', source: 'generated', content: JSON.stringify(content) });
  const reviews = createArtifactReviewStore(db, artifacts, dataRoot, { doc: documentReviewAdapter });
  const operations = documentBlocks(content).map((block, index) => ({ op: 'replaceText', blockId: block.id, start: 0, end: block.inlineSize, text: `修改段落 ${index + 1}` }));
  const proposal = await reviews.create({ artifactId: artifact.id, sessionId: 'session', expectedVersion: 1, operations, origin: { surface: 'chat', prompt: '改写' } });
  return { db, artifacts, dataRoot, artifact, reviews, proposal };
}
afterEach(() => { handles.splice(0).forEach((db) => db.close()); });

describe('artifact review publication', () => {
  it('lets the user revise a pending suggestion without touching the original or accepting an obsolete preview', async () => {
    const { artifacts, artifact, reviews, proposal } = await fixture();
    const change = proposal.changes[0];
    const next = await reviews.revise({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 1, changeId: change.id, operation: { ...(change.operation as object), text: '用户调整的候选文字' } });
    expect(next.reviewVersion).toBe(2); expect(next.changes[0].editedByUserAt).toBeTruthy();
    expect((await artifacts.get(artifact.id))?.content).toBe(artifact.content);
    await expect(reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 1, changeIds: [change.id], decision: 'accept' })).rejects.toThrow('审核状态');
    await reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 2, changeIds: [change.id], decision: 'accept' });
    const saved = (await artifacts.get(artifact.id))!;
    expect(saved.content).toContain('用户调整的候选文字'); expect(saved.content).toContain('第二段原文');
  });
  it('publishes the exact reviewed content, including generated block identities', async () => {
    const { artifacts, artifact, reviews } = await fixture();
    const proposal = await reviews.create({ artifactId: artifact.id, sessionId: 'session', expectedVersion: 1, origin: { surface: 'chat' }, operations: [{ op: 'insertBlocks', afterId: null, nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '新增摘要' }] }] }] });
    await reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 1, changeIds: proposal.changes.map((c) => c.id), decision: 'accept' });
    expect((await artifacts.get(artifact.id))?.content).toBe(proposal.candidateContent);
  });
  it('persists suggestions without changing the original and accepts changes individually', async () => {
    const { db, artifacts, dataRoot, artifact, reviews, proposal } = await fixture();
    expect((await artifacts.get(artifact.id))?.content).toBe(artifact.content);
    expect(createArtifactReviewStore(db, artifacts, dataRoot, { doc: documentReviewAdapter }).get(proposal.id)?.changes).toHaveLength(2);
    await expect(artifacts.addVersion(artifact.id, { content: artifact.content, origin: { surface: 'chat' } })).rejects.toThrow('待审核');
    const first = await reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 1, changeIds: [proposal.changes[0].id], decision: 'accept' });
    const latest = await artifacts.get(artifact.id);
    const parsed = parseDocumentContent(latest?.content ?? '');
    if (!parsed) throw new Error('Missing content');
    expect(documentBlocks(parsed).map((b) => b.text)).toEqual(['修改段落 1', '第二段原文']);
    expect(first).toMatchObject({ baseVersion: 2, reviewVersion: 2, status: 'partial' });
    await reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 1, changeIds: [proposal.changes[0].id], decision: 'accept' });
    expect((await artifacts.get(artifact.id))?.version).toBe(2);
    const done = await reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 2, changeIds: [proposal.changes[1].id], decision: 'accept' });
    expect(done.status).toBe('accepted');
    expect((await artifacts.get(artifact.id))?.version).toBe(3);
  });
  it('rejects stale accepts and allows rejecting the stale suggestions', async () => {
    const { artifacts, artifact, reviews, proposal } = await fixture();
    const edited = JSON.parse(artifact.content); edited.doc.content[0].content[0].text = '用户手动修改';
    const manual = JSON.stringify(edited);
    await artifacts.addVersion(artifact.id, { expectedVersion: 1, content: manual, origin: { surface: 'manual_edit' } });
    expect(reviews.get(proposal.id)?.stale).toBe(true);
    await expect(reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 1, changeIds: proposal.changes.map((c) => c.id), decision: 'accept' })).rejects.toThrow('原文已更新');
    const result = await reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 1, changeIds: proposal.changes.map((c) => c.id), decision: 'reject' });
    expect(result.status).toBe('rejected');
    expect((await artifacts.get(artifact.id))?.content).toBe(JSON.stringify(JSON.parse(manual)));
  });
  it('rolls back both the content and review decision if publication fails', async () => {
    const { db, artifacts, dataRoot, artifact, proposal } = await fixture();
    const failing = { ...artifacts, addVersion: (id: string, input: Parameters<typeof artifacts.addVersion>[1]) => artifacts.addVersion(id, { ...input, onCommit(version: number) { input.onCommit?.(version); throw new Error('simulated transaction failure'); } }) };
    const reviews = createArtifactReviewStore(db, failing, dataRoot, { doc: documentReviewAdapter });
    await expect(reviews.decide({ id: proposal.id, sessionId: 'session', expectedReviewVersion: 1, changeIds: [proposal.changes[0].id], decision: 'accept' })).rejects.toThrow('transaction failure');
    expect((await artifacts.get(artifact.id))?.version).toBe(1);
    expect(reviews.get(proposal.id)?.reviewVersion).toBe(1);
    expect(reviews.get(proposal.id)?.changes[0].status).toBe('pending');
  });
});

describe('reviews proposed in batches against one version', () => {
  async function longFixture(count = 120) {
    const db = openDb(':memory:'); handles.push(db);
    const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'reizo-review-batch-'));
    const artifacts = createArtifactStore(db, dataRoot);
    const reviews = createArtifactReviewStore(db, artifacts, dataRoot, { doc: documentReviewAdapter });
    const content = createDocumentContent({ type: 'doc', content: Array.from({ length: count }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `第${i}段原文内容` }] })) });
    const artifact = await artifacts.create({ sessionId: 'session', kind: 'doc', name: '长文', source: 'generated', content: JSON.stringify(content) });
    const blocks = documentBlocks(content);
    const batch = (from: number, to: number) => blocks.slice(from, to).map((b) => ({ op: 'replaceText', blockId: b.id, start: 0, end: b.inlineSize, text: `译文${b.text}` }));
    const propose = (from: number, to: number) => reviews.create({ artifactId: artifact.id, sessionId: 'session', expectedVersion: 1, origin: { surface: 'chat' }, operations: batch(from, to) });
    const acceptAll = (id: string) => { const r = reviews.get(id)!; return reviews.decide({ id, sessionId: 'session', expectedReviewVersion: r.reviewVersion, changeIds: r.changes.map((c) => c.id), decision: 'accept' }); };
    const translated = async () => documentBlocks(parseDocumentContent((await artifacts.get(artifact.id))!.content)!).filter((b) => b.text.startsWith('译文')).length;
    return { artifacts, artifact, reviews, blocks, propose, acceptAll, translated };
  }

  it('lets every batch be accepted in turn, so a long document can be processed in pieces', async () => {
    const f = await longFixture();
    const batches = [await f.propose(0, 40), await f.propose(40, 80), await f.propose(80, 120)];
    await f.acceptAll(batches[0].id);
    expect(f.reviews.get(batches[1].id)!.stale).toBe(true); // until the page asks for the list...
    await f.reviews.rebaseStale(f.artifact.id);
    expect(f.reviews.get(batches[1].id)!.stale).toBe(false);
    expect(f.reviews.get(batches[1].id)!.changes.length).toBe(40);
    await f.acceptAll(batches[1].id);
    await f.acceptAll(batches[2].id); // accepted straight away, without waiting for a refresh
    expect(await f.translated()).toBe(120);
  });

  it('does not rebase a batch when something it targets was edited meanwhile', async () => {
    const f = await longFixture(60);
    const first = await f.propose(0, 30);
    const second = await f.propose(20, 50); // overlaps blocks 20-29 with the first batch
    await f.acceptAll(first.id);
    await f.reviews.rebaseStale(f.artifact.id);
    const after = f.reviews.get(second.id)!;
    expect(after.stale).toBe(true);
    await expect(f.acceptAll(second.id)).rejects.toThrow('原文已更新');
    expect(await f.translated()).toBe(30);
  });
});
