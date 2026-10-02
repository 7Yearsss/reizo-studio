import type { CanvasAsset, CanvasAssetRegisterInput } from '../../../shared/canvasAssets';
import type { DbHandle } from '../db/client';

type Transaction = <T>(fn: () => T) => T;
interface AssetRow {
  id: string; path: string; canvas_id: string; node_id: string | null; kind: CanvasAsset['kind']; mime_type: string;
  byte_size: number; content_hash: string; source: CanvasAsset['source']; created_at: number; job_id: string | null;
  generation: number | null; provider_id: string | null; model: string | null; input_hash: string | null;
}
interface ProvenanceRow {
  id: string; canvas_id: string; node_id: string; node_type: string; generation: number;
  provider_id: string | null; model: string | null; input_hash: string | null;
}

export class CanvasAssetStoreError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}

function toAsset(row: AssetRow): CanvasAsset {
  return {
    id: row.id, path: row.path, canvasId: row.canvas_id, kind: row.kind, mimeType: row.mime_type,
    byteSize: row.byte_size, contentHash: row.content_hash, source: row.source, createdAt: new Date(row.created_at).toISOString(),
    ...(row.node_id !== null ? { nodeId: row.node_id } : {}),
    ...(row.job_id !== null ? { jobId: row.job_id } : {}),
    ...(row.generation !== null ? { generation: row.generation } : {}),
    ...(row.provider_id !== null ? { providerId: row.provider_id } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.input_hash !== null ? { inputHash: row.input_hash } : {}),
  };
}

const inputKeys = new Set(['id', 'path', 'canvasId', 'nodeId', 'kind', 'mimeType', 'byteSize', 'contentHash', 'source', 'jobId']);
function validate(input: CanvasAssetRegisterInput): void {
  if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !inputKeys.has(key))) {
    throw new CanvasAssetStoreError('Asset registration accepts file metadata only');
  }
  for (const [key, value] of Object.entries(input)) {
    if (key === 'byteSize' || value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) throw new CanvasAssetStoreError(`Asset ${key} must be a nonempty string`);
  }
  if (!input.id || !input.canvasId || !input.mimeType || !input.path || !input.contentHash) throw new CanvasAssetStoreError('Asset identity and file metadata are required');
  if (!/^[\da-f]{64}$/i.test(input.contentHash)) throw new CanvasAssetStoreError('Asset contentHash must be a SHA-256 hex digest');
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) throw new CanvasAssetStoreError('Asset byteSize must be a nonnegative integer');
  if (!['image', 'video', 'audio', 'mask'].includes(input.kind) || !['generated', 'imported', 'mask'].includes(input.source)) throw new CanvasAssetStoreError('Unsupported asset kind or source');
  const parts = input.path.split('/');
  if (parts.length !== 2 || parts[0] !== input.canvasId || !parts[1] || parts.some((part) => part === '.' || part === '..') ||
      input.path.includes('\\') || [...input.path].some((character) => character.charCodeAt(0) < 32)) {
    throw new CanvasAssetStoreError('Asset path must be a canvas-scoped relative file path');
  }
}

/** Metadata survives deletion of its source canvas, node and job. Fresh writes still require a valid origin. */
export function createCanvasAssetStore(handle: DbHandle, transaction: Transaction, jobs: { isCurrent(id: string): boolean }, inTransaction: () => boolean) {
  const raw = handle.raw;
  const byId = raw.prepare('SELECT * FROM canvas_assets WHERE id = ?');
  const byPath = raw.prepare('SELECT * FROM canvas_assets WHERE path = ?');
  const origin = raw.prepare('SELECT id FROM canvases WHERE id = ?');
  const node = raw.prepare('SELECT id FROM canvas_nodes WHERE canvas_id = ? AND id = ?');
  const job = raw.prepare('SELECT id, canvas_id, node_id, node_type, generation, provider_id, model, input_hash FROM canvas_jobs WHERE id = ?');
  const existing = (input: CanvasAssetRegisterInput) => (byId.get(input.id) ?? byPath.get(input.path)) as unknown as AssetRow | undefined;
  function replay(input: CanvasAssetRegisterInput, row: AssetRow): CanvasAsset {
    const matches = row.id === input.id && row.path === input.path && row.canvas_id === input.canvasId &&
      row.node_id === (input.nodeId ?? (input.jobId ? row.node_id : null)) && row.kind === input.kind &&
      row.mime_type === input.mimeType && row.byte_size === input.byteSize && row.content_hash === input.contentHash &&
      row.source === input.source && row.job_id === (input.jobId ?? null);
    if (!matches) throw new CanvasAssetStoreError('Asset identity or immutable metadata already belongs to a different registration', 409);
    return toAsset(row);
  }

  return {
    register(input: CanvasAssetRegisterInput): CanvasAsset {
      validate(input);
      // A historical idempotent registration is a read, independent of origin lifetime or active transactions.
      const receipt = existing(input);
      if (receipt) return replay(input, receipt);
      if (input.source === 'generated' && !inTransaction()) throw new CanvasAssetStoreError('Generated asset registration requires an outer transaction');
      return transaction(() => {
        const concurrent = existing(input);
        if (concurrent) return replay(input, concurrent);
        if (!origin.get(input.canvasId)) throw new CanvasAssetStoreError('Asset origin canvas not found', 404);
        if (input.source === 'generated' && !input.jobId) throw new CanvasAssetStoreError('Generated asset requires its owning job');
        const provenance = input.jobId ? job.get(input.jobId) as unknown as ProvenanceRow | undefined : undefined;
        if (input.jobId && (!provenance || !jobs.isCurrent(input.jobId))) throw new CanvasAssetStoreError('Asset job no longer owns this generation', 409);
        if (provenance && (provenance.canvas_id !== input.canvasId || (input.nodeId && provenance.node_id !== input.nodeId) ||
            (input.source === 'generated' && provenance.node_type !== input.kind))) throw new CanvasAssetStoreError('Asset origin does not match its job', 409);
        const nodeId = input.nodeId ?? provenance?.node_id;
        if (nodeId && !node.get(input.canvasId, nodeId)) throw new CanvasAssetStoreError('Asset origin node not found', 404);
        raw.prepare(`INSERT INTO canvas_assets
          (id, path, canvas_id, node_id, kind, mime_type, byte_size, content_hash, source, created_at, job_id, generation, provider_id, model, input_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          input.id, input.path, input.canvasId, nodeId ?? null, input.kind, input.mimeType, input.byteSize, input.contentHash,
          input.source, Date.now(), provenance?.id ?? null, provenance?.generation ?? null,
          provenance?.provider_id ?? null, provenance?.model ?? null, provenance?.input_hash ?? null,
        );
        return toAsset(byId.get(input.id) as unknown as AssetRow);
      });
    },
    get(id: string): CanvasAsset | null {
      const row = byId.get(id) as unknown as AssetRow | undefined;
      return row ? toAsset(row) : null;
    },
    findByPath(path: string): CanvasAsset | null {
      const row = byPath.get(path) as unknown as AssetRow | undefined;
      return row ? toAsset(row) : null;
    },
    list(canvasId: string): CanvasAsset[] {
      return (raw.prepare('SELECT * FROM canvas_assets WHERE canvas_id = ? ORDER BY created_at, rowid').all(canvasId) as unknown as AssetRow[]).map(toAsset);
    },
    recent(options: { kind?: 'image' | 'video' | 'audio'; limit?: number } = {}): CanvasAsset[] {
      const limit = options.limit ?? 80;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new CanvasAssetStoreError('Asset limit must be between 1 and 200');
      if (options.kind !== undefined && !['image', 'video', 'audio'].includes(options.kind)) throw new CanvasAssetStoreError('Unsupported library media kind');
      const rows = options.kind === undefined
        ? raw.prepare("SELECT * FROM canvas_assets WHERE kind IN ('image', 'video', 'audio') ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit)
        : raw.prepare('SELECT * FROM canvas_assets WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(options.kind, limit);
      return (rows as unknown as AssetRow[]).map(toAsset);
    },
  };
}

export type CanvasAssetStore = ReturnType<typeof createCanvasAssetStore>;
