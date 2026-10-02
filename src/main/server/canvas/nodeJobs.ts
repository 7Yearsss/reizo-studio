import type { CanvasNodeType } from '../../../shared/canvas';
import type { CanvasJob, CanvasJobFinish, CanvasJobTerminalStatus } from '../../../shared/canvasJobs';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import type { CanvasStore } from '../storage/canvasStore';
import { canvasWorkSignal, canvasWorkStopped } from './workLifecycle';

export type NodeJobCancellationReason = 'cancelled' | 'interrupted';

export class NodeJobsClosedError extends Error {
  readonly status = 503;
  constructor() { super('Media job runtime is shutting down'); }
}

export interface NodeJobContext {
  id: string;
  signal: AbortSignal;
  isCurrent(): boolean;
  markSubmitted(info: { providerId: string; model: string }): boolean;
  /** The node projection and terminal ledger row either both commit or both roll back. */
  finish<T>(status: CanvasJobTerminalStatus, project?: () => T | null, details?: CanvasJobFinish): T | null;
}

export interface NodeJobSubmission { job: CanvasJob; completion: Promise<void> }

interface ActiveJob {
  job: CanvasJob;
  controller: AbortController;
  completion: Promise<void>;
  release: () => void;
  cleanup: () => void;
  context: NodeJobContext;
  onCancelled: (reason: NodeJobCancellationReason) => (() => void) | void;
}

export interface NodeJobStartOptions {
  canvasId: string;
  nodeId: string;
  nodeType: CanvasNodeType;
  input: Record<string, unknown>;
  inputHash?: string;
  operationId?: string;
  signal?: AbortSignal;
  execute: (job: NodeJobContext) => Promise<void>;
  /** Writes within the terminal transaction; return an optional effect to run after commit. */
  onCancelled: (reason: NodeJobCancellationReason) => (() => void) | void;
  onFailure?: (error: unknown, job: NodeJobContext) => void;
}

export function createNodeJobs(store: CanvasStore) {
  const active = new Map<string, ActiveJob>();
  const byId = new Map<string, ActiveJob>();
  let closed = false;
  const workSignal = canvasWorkSignal(store);
  const keyFor = (canvasId: string, nodeId: string) => JSON.stringify([canvasId, nodeId]);
  const assertAccepting = () => { if (closed || canvasWorkStopped(store)) throw new NodeJobsClosedError(); };

  const replay = (canvasId: string, nodeId: string, operationId?: string, providerId?: string, nodeType: CanvasNodeType = 'image'): NodeJobSubmission | null => {
    assertAccepting();
    if (!operationId) return null;
    const job = store.jobs.findByOperationId(canvasId, operationId);
    if (!job) return null;
    const request = job.input.request as { providerId?: string } | undefined;
    if (job.nodeId !== nodeId || job.nodeType !== nodeType || request?.providerId !== providerId) {
      throw new CanvasJobStoreError(`operationId was already used for a different ${nodeType} request`, 409);
    }
    return { job, completion: byId.get(job.id)?.completion ?? Promise.resolve() };
  };

  function terminal<T>(entry: ActiveJob, status: CanvasJobTerminalStatus, project?: () => T | null, details: CanvasJobFinish = {}, detached = false): T | null {
    if (!detached && !entry.context.isCurrent()) return null;
    return store.transaction(() => {
      const current = store.jobs.isCurrent(entry.job.id);
      if (!current && (status === 'succeeded' || status === 'failed')) return null;
      const result = current && project ? project() : null;
      if (current && project && result === null) throw new Error('Canvas job projection did not update its node');
      if (!store.jobs.finish(entry.job.id, status, details)) {
        if (result !== null) throw new Error('Canvas job lost terminal ownership');
        return null;
      }
      return result;
    });
  }

  function remove(entry: ActiveJob): void {
    entry.cleanup();
    const key = keyFor(entry.job.canvasId, entry.job.nodeId);
    if (active.get(key) === entry) active.delete(key);
    if (byId.get(entry.job.id) === entry) byId.delete(entry.job.id);
    entry.release();
  }

  function cancel(entry: ActiveJob, reason: NodeJobCancellationReason): void {
    try {
      const effect = terminal(entry, reason === 'interrupted' ? 'interrupted' : 'cancelled', () => entry.onCancelled(reason), {
        cancelReason: reason === 'interrupted' ? 'host_shutdown' : 'user_cancelled',
        ...(reason === 'interrupted' ? { error: '任务因应用退出而中断，请重试。' } : {}),
      }, true);
      if (typeof effect === 'function') effect();
    } catch (error) {
      console.error('[canvas] job cancellation transaction failed', error);
    } finally {
      entry.controller.abort();
      remove(entry);
    }
  }

  function shutdown(): void {
    if (closed) return;
    closed = true;
    workSignal.removeEventListener('abort', shutdown);
    for (const entry of [...active.values()]) cancel(entry, 'interrupted');
  }

  // Lifecycle revocation happens synchronously, before the host can close SQLite.
  if (workSignal.aborted) shutdown();
  else workSignal.addEventListener('abort', shutdown, { once: true });

  return {
    assertAccepting,
    isAccepting: () => !closed,
    replay,
    start(options: NodeJobStartOptions): NodeJobSubmission {
      assertAccepting();
      const receipt = replay(options.canvasId, options.nodeId, options.operationId,
        (options.input.request as { providerId?: string } | undefined)?.providerId, options.nodeType);
      if (receipt) return receipt;
      const job = store.jobs.enqueue({ canvasId: options.canvasId, nodeId: options.nodeId, nodeType: options.nodeType,
        input: options.input, operationId: options.operationId, inputHash: options.inputHash });
      const key = keyFor(job.canvasId, job.nodeId);
      const previous = active.get(key);
      const controller = new AbortController();
      let release!: () => void;
      const completion = new Promise<void>((resolve) => { release = resolve; });
      const entry: ActiveJob = {
        job, controller, completion, release, onCancelled: options.onCancelled, cleanup: () => undefined,
        context: undefined as unknown as NodeJobContext,
      };
      const isCurrent = () => !closed && !canvasWorkStopped(store) && !controller.signal.aborted && active.get(key) === entry && store.jobs.isCurrent(job.id);
      entry.context = {
        id: job.id, signal: controller.signal, isCurrent,
        markSubmitted(info) {
          if (!isCurrent()) return false;
          const persisted = store.jobs.get(job.id);
          return persisted?.status === 'running'
            ? persisted.providerId === info.providerId && persisted.model === info.model
            : store.jobs.markSubmitted(job.id, info);
        },
        finish: (status, project, details) => terminal(entry, status, project, details),
      };
      active.set(key, entry);
      byId.set(job.id, entry);
      // enqueue revoked the old persisted generation before aborting its provider.
      if (previous) cancel(previous, 'cancelled');
      const forwardAbort = () => cancel(entry, 'cancelled');
      options.signal?.addEventListener('abort', forwardAbort, { once: true });
      entry.cleanup = () => options.signal?.removeEventListener('abort', forwardAbort);
      if (options.signal?.aborted) { cancel(entry, 'cancelled'); return { job, completion }; }
      void Promise.resolve().then(async () => {
        try {
          if (!isCurrent()) {
            if (!closed) cancel(entry, 'cancelled');
            return;
          }
          await options.execute(entry.context);
          if (isCurrent()) options.onFailure?.(new Error('Media execution ended without a terminal outcome'), entry.context);
        } catch (error) {
          if (isCurrent()) {
            try { options.onFailure?.(error, entry.context); }
            catch (failure) { console.error('[canvas] job failure projection failed', failure); }
          }
        } finally {
          if (!closed && !canvasWorkStopped(store) && byId.get(job.id) === entry) {
            const persisted = store.jobs.get(job.id);
            if (persisted?.status === 'queued' || persisted?.status === 'running') {
              cancel(entry, isCurrent() ? 'interrupted' : 'cancelled');
            }
          }
          remove(entry);
        }
      });
      return { job, completion };
    },
    cancelNode(canvasId: string, nodeId: string): boolean {
      const entry = active.get(keyFor(canvasId, nodeId));
      if (entry) cancel(entry, 'cancelled');
      return Boolean(entry);
    },
    cancelCanvas(canvasId: string): boolean {
      const entries = [...active.values()].filter((entry) => entry.job.canvasId === canvasId);
      for (const entry of entries) cancel(entry, 'cancelled');
      return entries.length > 0;
    },
    shutdown,
  };
}

const runtimes = new WeakMap<CanvasStore, ReturnType<typeof createNodeJobs>>();
export function nodeJobsFor(store: CanvasStore): ReturnType<typeof createNodeJobs> {
  let jobs = runtimes.get(store);
  if (!jobs) { jobs = createNodeJobs(store); runtimes.set(store, jobs); }
  return jobs;
}
