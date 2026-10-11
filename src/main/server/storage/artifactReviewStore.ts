import path from 'node:path';
import { nanoid } from 'nanoid';
import type { DbHandle } from '../db/client';
import type { ArtifactKind, ArtifactOrigin } from '../../../shared/artifact';
import type { ArtifactReview, ArtifactReviewChange, ReviewDecision } from '../../../shared/artifactReview';
import { ArtifactVersionConflictError, type ArtifactStore } from './artifactStore';
import { serializeFileMutation } from './atomicFile';

export interface ArtifactReviewAdapter {
  prepare?(content: string, operations: unknown[]): unknown[];
  apply(content: string, operations: unknown[]): string;
  describe(content: string, operation: unknown): { label: string; before: string; after: string };
  validateBatch?(content: string, operations: unknown[]): void;
  /** Re-anchor a pending operation after `accepted` operations were committed to the base. */
  rebase?(accepted: unknown[], operation: unknown): unknown;
  /** True when `operations` proposed against `baseContent` still mean the same thing on the newer `headContent` (nothing they target changed). */
  canRebase?(baseContent: string, headContent: string, operations: unknown[]): boolean;
}
export class ArtifactReviewError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) { super(message); }
}

export function createArtifactReviewStore(db: DbHandle, artifacts: ArtifactStore, dataRoot: string, adapters: Partial<Record<ArtifactKind, ArtifactReviewAdapter>>) {
  const raw = db.raw;
  function get(id: string): ArtifactReview | null {
    const row = raw.prepare('SELECT payload_json FROM artifact_reviews WHERE id = ?').get(id) as { payload_json: string } | undefined;
    if (!row) return null;
    const value = JSON.parse(row.payload_json) as ArtifactReview;
    const head = artifacts.getMeta(value.artifactId);
    return { ...value, stale: value.changes.some((c) => c.status === 'pending') && head?.version !== value.baseVersion };
  }
  function persist(review: ArtifactReview, previousVersion: number) {
    const result = raw.prepare('UPDATE artifact_reviews SET review_version = ?, payload_json = ?, updated_at = ? WHERE id = ? AND review_version = ?')
      .run(review.reviewVersion, JSON.stringify(review), Date.now(), review.id, previousVersion);
    if (result.changes !== 1) throw new ArtifactReviewError('审核状态已变化，请刷新后重试', 409);
  }
  function finalStatus(changes: ArtifactReviewChange[]): ArtifactReview['status'] {
    if (changes.every((c) => c.status === 'accepted')) return 'accepted';
    if (changes.every((c) => c.status === 'rejected')) return 'rejected';
    return changes.some((c) => c.status !== 'pending') ? 'partial' : 'pending';
  }
  /**
   * A review proposed against an older version stays usable when what happened since touched none of the
   * blocks it targets: a long task proposed in batches must not go stale because batch 1 was accepted first.
   * Caller holds the review's lock. Returns the rebased review, or null when it cannot be rebased.
   */
  async function tryRebase(review: ArtifactReview): Promise<ArtifactReview | null> {
    if (!review.stale) return null;
    const adapter = adapters[review.kind];
    if (!adapter?.canRebase) return null;
    const head = await artifacts.get(review.artifactId);
    if (!head) return null;
    const pending = review.changes.filter((c) => c.status === 'pending');
    const operations = pending.map((c) => c.operation);
    try {
      if (!adapter.canRebase(review.baseContent, head.content, operations)) return null;
      adapter.validateBatch?.(head.content, operations);
      const candidateContent = adapter.apply(head.content, operations);
      const changes = review.changes.map((c) => c.status === 'pending' ? { ...c, ...adapter.describe(head.content, c.operation) } : c);
      persist({ ...review, baseContent: head.content, baseVersion: head.version, candidateContent, changes, reviewVersion: review.reviewVersion + 1, updatedAt: new Date().toISOString() }, review.reviewVersion);
      return get(review.id);
    } catch { return null; }
  }
  return {
    get,
    /** Move every stale review of this artifact that can safely follow it onto its latest version. */
    async rebaseStale(artifactId: string): Promise<void> {
      const stale = (raw.prepare('SELECT id FROM artifact_reviews WHERE artifact_id = ?').all(artifactId) as { id: string }[]).map((row) => get(row.id)).filter((r): r is ArtifactReview => Boolean(r?.stale));
      for (const review of stale) await serializeFileMutation(path.join(dataRoot, 'review-locks', review.id), async () => { const fresh = get(review.id); if (fresh?.stale) await tryRebase(fresh); });
    },
    list(artifactId: string): ArtifactReview[] {
      const rows = raw.prepare('SELECT id FROM artifact_reviews WHERE artifact_id = ? ORDER BY created_at DESC').all(artifactId) as { id: string }[];
      return rows.map((row) => get(row.id)).filter((item): item is ArtifactReview => item !== null);
    },
    async create(input: { artifactId: string; sessionId: string; expectedVersion: number; operations: unknown[]; origin: ArtifactOrigin }): Promise<ArtifactReview> {
      const artifact = await artifacts.get(input.artifactId);
      if (!artifact || artifact.sessionId !== input.sessionId) throw new ArtifactReviewError('未找到本会话的文档', 404);
      if (artifact.version !== input.expectedVersion) throw new ArtifactVersionConflictError();
      const adapter = adapters[artifact.kind];
      if (!adapter) throw new ArtifactReviewError('该产物暂不支持修改建议');
      if (!input.operations.length || input.operations.length > 40) throw new ArtifactReviewError('每轮建议需要 1 至 40 项修改');
      const operations = adapter.prepare?.(artifact.content, input.operations) ?? input.operations;
      adapter.validateBatch?.(artifact.content, operations);
      const candidateContent = adapter.apply(artifact.content, operations);
      if (candidateContent === artifact.content) throw new ArtifactReviewError('没有需要审核的修改');
      const now = new Date().toISOString();
      const review: ArtifactReview = { id: nanoid(), artifactId: artifact.id, sessionId: input.sessionId, kind: artifact.kind,
        initialVersion: artifact.version, baseVersion: artifact.version, reviewVersion: 1, baseContent: artifact.content, candidateContent,
        changes: operations.map((operation) => ({ id: nanoid(), operation, status: 'pending', ...adapter.describe(artifact.content, operation) })),
        origin: input.origin, status: 'pending', stale: false, createdAt: now, updatedAt: now };
      if (JSON.stringify(review).length > 16_000_000) throw new ArtifactReviewError('建议内容过大，请缩小修改范围');
      raw.prepare('INSERT INTO artifact_reviews (id, artifact_id, review_version, payload_json, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)')
        .run(review.id, artifact.id, JSON.stringify(review), Date.now(), Date.now());
      return get(review.id) as ArtifactReview;
    },
    async revise(input: { id: string; sessionId: string; expectedReviewVersion: number; changeId: string; operation: unknown }): Promise<ArtifactReview> {
      if (!/^[\w-]{1,128}$/.test(input.id)) throw new ArtifactReviewError('无效的建议 ID');
      return serializeFileMutation(path.join(dataRoot, 'review-locks', input.id), async () => {
        const review = get(input.id);
        if (!review || review.sessionId !== input.sessionId) throw new ArtifactReviewError('未找到修改建议', 404);
        const target = review.changes.find((change) => change.id === input.changeId);
        if (review.stale || review.reviewVersion !== input.expectedReviewVersion || target?.status !== 'pending') throw new ArtifactReviewError('原文或审核状态已变化，请刷新后重试', 409);
        const adapter = adapters[review.kind]; if (!adapter) throw new ArtifactReviewError('不支持编辑该建议');
        const operation = adapter.prepare?.(review.baseContent, [input.operation])[0] ?? input.operation;
        const changes = review.changes.map((change) => change.id === target.id ? { ...change, operation, ...adapter.describe(review.baseContent, operation), editedByUserAt: new Date().toISOString() } : change);
        const operations = changes.filter((change) => change.status === 'pending').map((change) => change.operation);
        adapter.validateBatch?.(review.baseContent, operations);
        const candidateContent = adapter.apply(review.baseContent, operations);
        if (candidateContent === review.baseContent) throw new ArtifactReviewError('建议没有修改；如需保留原文，请拒绝该建议');
        const next = { ...review, changes, candidateContent, reviewVersion: review.reviewVersion + 1, updatedAt: new Date().toISOString() };
        if (JSON.stringify(next).length > 16_000_000) throw new ArtifactReviewError('建议内容过大，请缩小修改范围');
        persist(next, review.reviewVersion); return get(review.id) as ArtifactReview;
      });
    },
    /** Swap some pending changes for freshly proposed ones (e.g. a paragraph rewritten again from the user's feedback). */
    async replaceChanges(input: { id: string; sessionId: string; expectedReviewVersion: number; removeIds: string[]; operations: unknown[] }): Promise<ArtifactReview> {
      if (!/^[\w-]{1,128}$/.test(input.id)) throw new ArtifactReviewError('无效的建议 ID');
      return serializeFileMutation(path.join(dataRoot, 'review-locks', input.id), async () => {
        const review = get(input.id);
        if (!review || review.sessionId !== input.sessionId) throw new ArtifactReviewError('未找到修改建议', 404);
        const remove = new Set(input.removeIds);
        if (review.stale || review.reviewVersion !== input.expectedReviewVersion || !remove.size || review.changes.filter((c) => remove.has(c.id)).some((c) => c.status !== 'pending') || review.changes.filter((c) => remove.has(c.id)).length !== remove.size) throw new ArtifactReviewError('原文或审核状态已变化，请刷新后重试', 409);
        const adapter = adapters[review.kind]; if (!adapter) throw new ArtifactReviewError('不支持编辑该建议');
        const prepared = adapter.prepare?.(review.baseContent, input.operations) ?? input.operations;
        const fresh: ArtifactReviewChange[] = prepared.map((operation) => ({ id: nanoid(), operation, status: 'pending', ...adapter.describe(review.baseContent, operation) }));
        const at = review.changes.findIndex((c) => remove.has(c.id));
        const changes = [...review.changes.slice(0, at).filter((c) => !remove.has(c.id)), ...fresh, ...review.changes.slice(at).filter((c) => !remove.has(c.id))];
        const operations = changes.filter((c) => c.status === 'pending').map((c) => c.operation);
        adapter.validateBatch?.(review.baseContent, operations);
        const candidateContent = adapter.apply(review.baseContent, operations);
        if (candidateContent === review.baseContent) throw new ArtifactReviewError('建议没有修改');
        const next: ArtifactReview = { ...review, changes, candidateContent, status: finalStatus(changes), reviewVersion: review.reviewVersion + 1, updatedAt: new Date().toISOString() };
        if (JSON.stringify(next).length > 16_000_000) throw new ArtifactReviewError('建议内容过大，请缩小修改范围');
        persist(next, review.reviewVersion); return get(review.id) as ArtifactReview;
      });
    },
    async decide(input: { id: string; sessionId: string; expectedReviewVersion: number; changeIds: string[]; decision: ReviewDecision }): Promise<ArtifactReview> {
      if (input.decision !== 'accept' && input.decision !== 'reject') throw new ArtifactReviewError('无效的审核动作');
      if (!/^[\w-]{1,128}$/.test(input.id)) throw new ArtifactReviewError('无效的建议 ID');
      return serializeFileMutation(path.join(dataRoot, 'review-locks', input.id), async () => {
        let review = get(input.id);
        if (!review || review.sessionId !== input.sessionId) throw new ArtifactReviewError('未找到修改建议', 404);
        let expectedReviewVersion = input.expectedReviewVersion;
        // The page may still show this review as it was before it followed the document to its newer version.
        if (input.decision === 'accept' && review.stale) {
          const before = review.reviewVersion;
          const rebased = await tryRebase(review);
          if (rebased) { review = rebased; if (expectedReviewVersion === before) expectedReviewVersion = rebased.reviewVersion; }
        }
        const ids = new Set(input.changeIds);
        const selected = review.changes.filter((c) => ids.has(c.id));
        if (!ids.size || selected.length !== ids.size) throw new ArtifactReviewError('请选择有效的修改项');
        const nextStatus = input.decision === 'accept' ? 'accepted' : 'rejected';
        if (selected.every((c) => c.status === nextStatus)) return review;
        if (review.reviewVersion !== expectedReviewVersion || selected.some((c) => c.status !== 'pending')) throw new ArtifactReviewError('审核状态已变化，请刷新后重试', 409);
        const adapter = adapters[review.kind];
        if (!adapter) throw new ArtifactReviewError('该产物暂不支持审核');
        const changes: ArtifactReviewChange[] = review.changes.map((c) => ids.has(c.id) ? { ...c, status: nextStatus, decidedAt: new Date().toISOString() } : c);
        const pending = changes.filter((c) => c.status === 'pending').map((c) => c.operation);
        const next: ArtifactReview = { ...review, changes, reviewVersion: review.reviewVersion + 1, status: finalStatus(changes), updatedAt: new Date().toISOString() };
        if (input.decision === 'reject') {
          next.candidateContent = adapter.apply(review.baseContent, pending);
          persist(next, review.reviewVersion);
          return get(review.id) as ArtifactReview;
        }
        if (review.stale) throw new ArtifactReviewError('原文已更新，请基于最新内容重新生成建议', 409);
        const acceptedOps = selected.map((c) => c.operation);
        const content = pending.length === 0 ? review.candidateContent : adapter.apply(review.baseContent, acceptedOps);
        next.baseContent = content;
        next.changes = next.changes.map((change) => {
          if (change.status !== 'pending') return change;
          const operation = adapter.rebase?.(acceptedOps, change.operation) ?? change.operation;
          return { ...change, operation, ...adapter.describe(content, operation) };
        });
        next.candidateContent = adapter.apply(content, next.changes.filter((c) => c.status === 'pending').map((c) => c.operation));
        const updated = await artifacts.addVersion(review.artifactId, {
          expectedVersion: review.baseVersion, content, origin: { ...review.origin, surface: 'manual_edit' }, label: 'Accepted AI edits',
          onCommit(version) {
            next.baseVersion = version;
            next.changes = next.changes.map((c) => ids.has(c.id) ? { ...c, acceptedVersion: version } : c);
            persist(next, review.reviewVersion);
          },
        });
        if (!updated) throw new ArtifactReviewError('文档已被删除', 404);
        return get(review.id) as ArtifactReview;
      });
    },
  };
}

export type ArtifactReviewStore = ReturnType<typeof createArtifactReviewStore>;
