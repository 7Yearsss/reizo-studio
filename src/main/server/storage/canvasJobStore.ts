import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type {
  CanvasJob,
  CanvasJobEnqueueInput,
  CanvasJobFinish,
  CanvasJobStatus,
  CanvasJobTerminalStatus,
  CanvasRemoteTask,
} from '../../../shared/canvasJobs';
import { isCanvasJobTerminal } from '../../../shared/canvasJobs';
import type { DbHandle } from '../db/client';

type Transaction = <T>(fn: () => T) => T;

interface JobRow {
  id: string;
  canvas_id: string;
  node_id: string;
  node_type: CanvasJob['nodeType'];
  generation: number;
  operation_id: string | null;
  status: CanvasJobStatus;
  input_json: string;
  request_hash: string;
  provider_id: string | null;
  model: string | null;
  input_hash: string | null;
  remote_task_json: string | null;
  result_json: string | null;
  error: string | null;
  cancel_reason: string | null;
  created_at: number;
  submitted_at: number | null;
  ended_at: number | null;
}

export class CanvasJobStoreError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}

const credentialKeys = new Set([
  'apikey', 'authorization', 'accesstoken', 'refreshtoken', 'password', 'secret', 'clientsecret', 'credentials',
]);

/** Freeze a deterministic JSON snapshot and reject accidentally supplied provider configuration. */
function snapshot(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') throw new CanvasJobStoreError('Job data must contain only JSON values');
  if (ancestors.has(value)) throw new CanvasJobStoreError('Job data must not contain cycles');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new CanvasJobStoreError('Job data must contain only JSON objects');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => snapshot(item, ancestors));
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => {
        if (credentialKeys.has(key.toLowerCase().replace(/[_-]/g, ''))) {
          throw new CanvasJobStoreError('Provider credentials must not be stored in job data');
        }
        return [key, snapshot(item, ancestors)];
      }));
  } finally { ancestors.delete(value); }
}

function jsonObject(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanvasJobStoreError('Job input and result must be JSON objects');
  return JSON.stringify(snapshot(value));
}

function toJob(row: JobRow): CanvasJob {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    nodeId: row.node_id,
    nodeType: row.node_type,
    generation: row.generation,
    status: row.status,
    input: JSON.parse(row.input_json),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.operation_id !== null ? { operationId: row.operation_id } : {}),
    ...(row.provider_id !== null ? { providerId: row.provider_id } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.input_hash !== null ? { inputHash: row.input_hash } : {}),
    ...(row.remote_task_json !== null ? { remoteTask: JSON.parse(row.remote_task_json) } : {}),
    ...(row.result_json !== null ? { result: JSON.parse(row.result_json) } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    ...(row.cancel_reason !== null ? { cancelReason: row.cancel_reason } : {}),
    ...(row.submitted_at !== null ? { submittedAt: new Date(row.submitted_at).toISOString() } : {}),
    ...(row.ended_at !== null ? { endedAt: new Date(row.ended_at).toISOString() } : {}),
  };
}

/** Uses the canvas repository's transaction so job admission/results can commit with document changes. */
export function createCanvasJobStore(handle: DbHandle, transaction: Transaction) {
  const raw = handle.raw;
  const byId = raw.prepare('SELECT * FROM canvas_jobs WHERE id = ?');
  const byOperation = raw.prepare('SELECT * FROM canvas_jobs WHERE canvas_id = ? AND operation_id = ?');
  const latest = raw.prepare('SELECT * FROM canvas_jobs WHERE canvas_id = ? AND node_id = ? ORDER BY generation DESC LIMIT 1');
  const nodeById = raw.prepare('SELECT type FROM canvas_nodes WHERE canvas_id = ? AND id = ?');
  const currentActive = raw.prepare(`SELECT j.id FROM canvas_jobs j
    WHERE j.id = ? AND j.status IN ('queued', 'running')
      AND EXISTS (SELECT 1 FROM canvas_nodes n WHERE n.canvas_id = j.canvas_id AND n.id = j.node_id)
      AND NOT EXISTS (SELECT 1 FROM canvas_jobs newer WHERE newer.canvas_id = j.canvas_id AND newer.node_id = j.node_id AND newer.generation > j.generation)`);
  const getRow = (id: string): JobRow | null => (byId.get(id) as unknown as JobRow) ?? null;
  const isCurrent = (id: string): boolean => Boolean(currentActive.get(id));

  return {
    enqueue(input: CanvasJobEnqueueInput): CanvasJob {
      if (input.operationId !== undefined && (!input.operationId.trim() || input.operationId.length > 256)) {
        throw new CanvasJobStoreError('operationId must contain 1 to 256 characters');
      }
      const inputJson = jsonObject(input.input);
      const requestHash = createHash('sha256').update(JSON.stringify(snapshot({
        nodeId: input.nodeId, nodeType: input.nodeType, input: JSON.parse(inputJson),
        providerId: input.providerId, model: input.model, inputHash: input.inputHash,
      }))).digest('hex');
      return transaction(() => {
        // A retry of an older operation never steals the latest generation's ownership.
        const receipt = input.operationId ? byOperation.get(input.canvasId, input.operationId) as unknown as JobRow | undefined : undefined;
        if (receipt) {
          if (receipt.request_hash !== requestHash) throw new CanvasJobStoreError('operationId was already used for a different job', 409);
          return toJob(receipt);
        }
        const node = nodeById.get(input.canvasId, input.nodeId) as { type: string } | undefined;
        if (!node) throw new CanvasJobStoreError('Canvas node not found', 404);
        if (node.type !== input.nodeType) throw new CanvasJobStoreError('Job node type does not match the canvas node');
        const previous = latest.get(input.canvasId, input.nodeId) as unknown as JobRow | undefined;
        const generation = (previous?.generation ?? 0) + 1;
        const now = Date.now();
        raw.prepare(`UPDATE canvas_jobs SET status = 'cancelled', cancel_reason = 'superseded', ended_at = ?
          WHERE canvas_id = ? AND node_id = ? AND status IN ('queued', 'running')`).run(now, input.canvasId, input.nodeId);
        const id = nanoid();
        raw.prepare(`INSERT INTO canvas_jobs
          (id, canvas_id, node_id, node_type, generation, operation_id, status, input_json, request_hash, provider_id, model, input_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`).run(
          id, input.canvasId, input.nodeId, input.nodeType, generation, input.operationId ?? null,
          inputJson, requestHash, input.providerId ?? null, input.model ?? null, input.inputHash ?? null, now,
        );
        return toJob(getRow(id));
      });
    },

    get(id: string): CanvasJob | null {
      const row = getRow(id);
      return row ? toJob(row) : null;
    },

    current(canvasId: string, nodeId: string): CanvasJob | null {
      const row = latest.get(canvasId, nodeId) as unknown as JobRow | undefined;
      return row ? toJob(row) : null;
    },

    findByOperationId(canvasId: string, operationId: string): CanvasJob | null {
      const row = byOperation.get(canvasId, operationId) as unknown as JobRow | undefined;
      return row ? toJob(row) : null;
    },

    list(canvasId?: string, limit?: number): CanvasJob[] {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)) {
        throw new CanvasJobStoreError('Job list limit must be an integer between 1 and 500');
      }
      if (canvasId !== undefined && limit !== undefined) {
        return (raw.prepare('SELECT * FROM canvas_jobs WHERE canvas_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
          .all(canvasId, limit) as unknown as JobRow[]).map(toJob);
      }
      const rows = canvasId === undefined
        ? raw.prepare('SELECT * FROM canvas_jobs ORDER BY created_at, canvas_id, node_id, generation').all()
        : raw.prepare('SELECT * FROM canvas_jobs WHERE canvas_id = ? ORDER BY created_at, node_id, generation').all(canvasId);
      return (rows as unknown as JobRow[]).map(toJob);
    },

    unfinished(): CanvasJob[] {
      return (raw.prepare("SELECT * FROM canvas_jobs WHERE status IN ('queued', 'running') ORDER BY created_at, id")
        .all() as unknown as JobRow[]).map(toJob);
    },

    isCurrent,

    markSubmitted(id: string, info: { providerId?: string; model?: string } = {}): boolean {
      return transaction(() => {
        if (!isCurrent(id)) return false;
        return raw.prepare(`UPDATE canvas_jobs SET status = 'running', submitted_at = ?,
          provider_id = COALESCE(?, provider_id), model = COALESCE(?, model)
          WHERE id = ? AND status = 'queued'`).run(Date.now(), info.providerId ?? null, info.model ?? null, id).changes === 1;
      });
    },

    /** Persist before polling. A generation can never be rebound to another paid task. */
    recordRemoteTask(id: string, remoteTask: CanvasRemoteTask): boolean {
      if (!remoteTask.driverId?.trim() || !remoteTask.taskId?.trim() || remoteTask.taskId.length > 2048) {
        throw new CanvasJobStoreError('Remote task requires a driver and task ID');
      }
      const remoteJson = jsonObject(remoteTask);
      return transaction(() => {
        if (!isCurrent(id)) return false;
        const row = getRow(id);
        if (row.status !== 'running') return false;
        if (row.remote_task_json !== null) {
          if (row.remote_task_json !== remoteJson) throw new CanvasJobStoreError('Job already owns a different remote task', 409);
          return true;
        }
        return raw.prepare(`UPDATE canvas_jobs SET remote_task_json = ?
          WHERE id = ? AND status = 'running' AND remote_task_json IS NULL`).run(remoteJson, id).changes === 1;
      });
    },

    finish(id: string, status: CanvasJobTerminalStatus, details: CanvasJobFinish = {}): boolean {
      if (!isCanvasJobTerminal(status)) throw new CanvasJobStoreError('Job completion requires a terminal status');
      const resultJson = details.result === undefined ? null : jsonObject(details.result);
      return transaction(() => {
        if ((status === 'succeeded' || status === 'failed') && !isCurrent(id)) return false;
        return raw.prepare(`UPDATE canvas_jobs SET status = ?, result_json = ?, error = ?, cancel_reason = ?, ended_at = ?
          WHERE id = ? AND status IN ('queued', 'running')`).run(
          status, resultJson, details.error ?? null, details.cancelReason ?? null, Date.now(), id,
        ).changes === 1;
      });
    },
  };
}

export type CanvasJobStore = ReturnType<typeof createCanvasJobStore>;
