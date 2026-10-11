import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { createDocumentContent, documentBlocks, parseDocumentContent } from '../../../shared/documentContent';
import { documentReviewAdapter } from './documentReviewAdapter';
import { regenerateDocumentChange, regeneratePrompt } from './regenerateChange';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => { handles.splice(0).forEach((db) => db.close()); });

async function fixture() {
  const db = openDb(':memory:'); handles.push(db);
  const root = mkdtempSync(path.join(tmpdir(), 'regen-'));
  const artifacts = createArtifactStore(db, root);
  const reviews = createArtifactReviewStore(db, artifacts, root, { doc: documentReviewAdapter });
  const content = createDocumentContent({ type: 'doc', content: ['项目预计十月上线，团队保持稳定。', '第二段保持不变。', '这一段也要改写。'].map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
  const artifact = await artifacts.create({ sessionId: 's', kind: 'doc', name: '方案', source: 'generated', content: JSON.stringify(content) });
  const [first, , third] = documentBlocks(content);
  const review = await reviews.create({ artifactId: artifact.id, sessionId: 's', expectedVersion: 1, origin: { surface: 'chat' }, operations: [
    { op: 'replaceText', blockId: first.id, start: 0, end: first.inlineSize, text: '项目预计将于十一月初正式上线，团队保持稳定。' },
    { op: 'replaceText', blockId: third.id, start: 0, end: third.inlineSize, text: '这一段需要被改写。' },
  ] });
  return { artifacts, reviews, artifact, review, first, third };
}

describe('regenerateDocumentChange', () => {
  it('replaces the hunks of one paragraph with a fresh rewrite from the feedback and leaves the others alone', async () => {
    const f = await fixture();
    expect(f.review.changes.length).toBeGreaterThanOrEqual(2);
    const target = f.review.changes.find((c) => (c.operation as { blockId: string }).blockId === f.first.id)!;
    const rewrite = vi.fn(async () => '```\n项目十一月初上线，团队稳定。\n```');
    const next = await regenerateDocumentChange(f.reviews, rewrite, { review: f.review, changeId: target.id, feedback: '更简短一点' });
    const [system, prompt] = rewrite.mock.calls[0] as unknown as [string, string];
    expect(system).toContain('只输出重写后的整段文字');
    expect(prompt).toBe(regeneratePrompt({ original: '项目预计十月上线，团队保持稳定。', proposed: '项目预计将于十一月初正式上线，团队保持稳定。', feedback: '更简短一点' }));
    const candidate = documentBlocks(parseDocumentContent(next.candidateContent)!).map((b) => b.text);
    expect(candidate).toEqual(['项目十一月初上线，团队稳定。', '第二段保持不变。', '这一段需要被改写。']);
    expect(next.reviewVersion).toBe(f.review.reviewVersion + 1);
    expect(next.changes.every((c) => c.status === 'pending')).toBe(true);
    expect(next.changes.some((c) => c.after === '这一段需要被改写。' || c.label.includes('改写') || (c.operation as { blockId: string }).blockId === f.third.id)).toBe(true);
    expect(next.changes.find((c) => (c.operation as { reason?: string }).reason?.includes('更简短一点'))).toBeTruthy();
  });

  it('refuses an empty reply, an unchanged paragraph, a stale review and a missing feedback', async () => {
    const f = await fixture();
    const target = f.review.changes[0];
    await expect(regenerateDocumentChange(f.reviews, async () => '  ', { review: f.review, changeId: target.id, feedback: '更口语' })).rejects.toThrow('没有得到新的改写');
    await expect(regenerateDocumentChange(f.reviews, async () => '项目预计十月上线，团队保持稳定。', { review: f.review, changeId: target.id, feedback: '更口语' })).rejects.toThrow('相同');
    await expect(regenerateDocumentChange(f.reviews, async () => '好', { review: f.review, changeId: target.id, feedback: '  ' })).rejects.toThrow('想怎么改');
    await f.artifacts.addVersion(f.artifact.id, { expectedVersion: 1, content: JSON.stringify({ ...parseDocumentContent(f.artifact.content)!, importWarnings: ['x'] }), origin: { surface: 'manual_edit' } });
    await expect(regenerateDocumentChange(f.reviews, async () => '好', { review: { ...f.review, stale: true }, changeId: target.id, feedback: '更口语' })).rejects.toThrow('原文已更新');
  });
});
