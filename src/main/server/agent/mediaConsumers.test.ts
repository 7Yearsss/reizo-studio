import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore, type CanvasStore } from '../storage/canvasStore';
import type { CanvasNode } from '../../../shared/canvas';
import type { CanvasJob, CanvasJobTerminalStatus } from '../../../shared/canvasJobs';
import type { SettingsStore } from '../storage/settingsStore';
import type { ProviderStore } from '../storage/providerStore';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import { getCanvasChannel } from '../canvas/channel';
import { canvasWorkStopped, stopCanvasWork } from '../canvas/workLifecycle';
import { NodeJobsClosedError } from '../canvas/nodeJobs';
import { createCanvasBudget } from './canvasBudget';
import { createCanvasTools } from './canvasTools';
import { createCanvasRouter } from '../routes/canvas';
import { runGraph, stopCanvasRun } from '../canvas/graphExecutor';

const admissions = vi.hoisted(() => vi.fn());
vi.mock('../canvas/videoExecutor', () => ({
  startVideoNode: (options: FakeOptions) => fakeStart(options),
  replayVideoJob: (store: CanvasStore, canvasId: string, nodeId: string, operationId?: string, providerId?: string) => fakeReplay(store, canvasId, nodeId, operationId, providerId),
}));
vi.mock('../canvas/audioExecutor', () => ({
  startAudioNode: (options: FakeOptions) => fakeStart(options),
  replayAudioJob: (store: CanvasStore, canvasId: string, nodeId: string, operationId?: string, providerId?: string) => fakeReplay(store, canvasId, nodeId, operationId, providerId, 'audio'),
}));

interface FakeOptions { canvasStore: CanvasStore; canvasId: string; node: CanvasNode; operationId?: string; providerId?: string; signal?: AbortSignal }
interface Execution { store: CanvasStore; job: CanvasJob; completion: Promise<void>; resolve: () => void; cleanup: () => void }
const executions = new Map<string, Execution>();

function fakeReplay(store: CanvasStore, canvasId: string, nodeId: string, operationId?: string, providerId?: string, type: 'video' | 'audio' = 'video') {
  if (canvasWorkStopped(store)) throw new NodeJobsClosedError();
  const job = operationId ? store.jobs.findByOperationId(canvasId, operationId) : null;
  if (!job) return null;
  if (job.nodeId !== nodeId || job.nodeType !== type || (job.input.request as { providerId?: string })?.providerId !== providerId) {
    throw new CanvasJobStoreError('operationId was already used for another video', 409);
  }
  return { job, completion: executions.get(job.id)?.completion ?? Promise.resolve() };
}

function fakeStart(options: FakeOptions) {
  const { canvasStore: store, canvasId, node, operationId, providerId, signal } = options;
  const type = node.type as 'video' | 'audio';
  const replay = fakeReplay(store, canvasId, node.id, operationId, providerId, type);
  if (replay) return replay;
  const previous = store.jobs.current(canvasId, node.id);
  const job = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: type, operationId,
    input: { request: { providerId }, node } });
  executions.get(previous?.id)?.resolve();
  store.jobs.markSubmitted(job.id, { providerId: 'test-video', model: 'test-video' });
  const running = store.updateNode(canvasId, node.id, { runState: 'running' });
  let resolve!: () => void;
  const completion = new Promise<void>((done) => { resolve = done; });
  const abort = () => finish(job.id, 'cancelled');
  const entry = { store, job, completion, resolve, cleanup: () => signal?.removeEventListener('abort', abort) };
  executions.set(job.id, entry);
  signal?.addEventListener('abort', abort, { once: true });
  admissions(job.id);
  if (running) getCanvasChannel(canvasId).broadcast(running.rev, { type: 'node_updated', node: running.node });
  if (signal?.aborted) abort();
  return { job, completion };
}

function finish(jobId: string, status: CanvasJobTerminalStatus) {
  const entry = executions.get(jobId);
  if (!entry) return;
  const { store, job } = entry;
  const error = `${job.nodeType} failed`;
  const result = store.transaction(() => {
    const current = store.jobs.isCurrent(jobId);
    const saved = store.jobs.finish(jobId, status, status === 'failed' ? { error }
      : status === 'succeeded' ? { result: { assets: [`${jobId}.mp4`] } } : { cancelReason: 'user_cancelled' });
    if (!saved || !current) return null;
    return store.updateNode(job.canvasId, job.nodeId, { runState: status === 'succeeded' ? 'done' : status === 'cancelled' ? 'idle' : 'error',
      output: status === 'succeeded' ? { assets: [`${jobId}.mp4`] } : status === 'failed' ? { error } : {} });
  });
  if (result) getCanvasChannel(job.canvasId).broadcast(result.rev, { type: 'node_updated', node: result.node });
  entry.cleanup();
  entry.resolve();
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
  admissions.mockClear();
  vi.restoreAllMocks();
});
const settingsStore = { get: async () => ({ providers: {} }) } as unknown as SettingsStore;
async function fixture(type: 'video' | 'audio' = 'video', hasProviders = true) {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('media-consumers', null, null);
  const store = createCanvasStore(handle);
  const canvasId = store.ensureCanvas(session.id).id;
  const node = store.addNode(canvasId, { type, x: 0, y: 0, w: 100, h: 100, params: { prompt: type } }).node;
  const providerStore = hasProviders ? {} as ProviderStore : undefined;
  const budget = createCanvasBudget({ execute: 1 });
  const { tools } = createCanvasTools({ sessionId: session.id, canvasStore: store, settingsStore, providerStore, dataRoot: '.', budget });
  const execute = tools.run_node.execute as unknown as (input: Record<string, unknown>, options: { toolCallId: string }) => Promise<Record<string, unknown>>;
  const app = new Hono().route('/api/canvas', createCanvasRouter(store, settingsStore, sessions, '.', undefined, providerStore));
  cleanup.push(() => {
    stopCanvasWork(store);
    for (const [id, entry] of executions) {
      if (entry.store !== store) continue;
      finish(id, 'cancelled');
      executions.delete(id);
    }
    handle.close();
  });
  const post = (operationId: string, id = node.id, confirmedSpend = true) => app.request(`/api/canvas/${canvasId}/nodes/${id}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify({ confirmedSpend }),
  });
  return { handle, store, node, canvasId, execute, budget, post, tools, providerStore,
    start: (operationId: string) => fakeStart({ canvasStore: store, canvasId, node, operationId }) };
}

describe.each(['video', 'audio'] as const)('durable %s consumers', (type) => {
  it('HTTP returns a persisted accepted identity and replays the completed request without new submission', async () => {
    const { post, store, canvasId } = await fixture(type);
    const response = await post('http-operation');
    expect(response.status).toBe(202);
    const first = await response.json();
    expect(store.jobs.get(first.jobId)).toMatchObject({ nodeType: type, operationId: 'http-operation' });
    finish(first.jobId, 'succeeded');
    expect(await (await post('http-operation')).json()).toMatchObject({ jobId: first.jobId, status: 'succeeded' });
    expect(store.jobs.list(canvasId)).toHaveLength(1);
    expect(admissions).toHaveBeenCalledTimes(1);
  });

  it('HTTP rejects admission failure and missing spend confirmation before any provider submission', async () => {
    const { handle, post, store, canvasId } = await fixture(type);
    expect((await post('unconfirmed', undefined, false)).status).toBe(402);
    handle.raw.exec("CREATE TRIGGER deny_video BEFORE INSERT ON canvas_jobs BEGIN SELECT RAISE(ABORT, 'video admission failed'); END");
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await post('failed')).status).toBe(500);
    expect(store.jobs.list(canvasId)).toEqual([]);
    expect(admissions).not.toHaveBeenCalled();
  });

  it('Agent replay bypasses fuse and quota while reporting the original superseded job', async () => {
    const { node, execute, start, store, canvasId, budget } = await fixture(type);
    const first = await execute({ id: node.id, wait: false }, { toolCallId: 'old-video' });
    const newer = start('new-video');
    finish(newer.job.id, 'succeeded');
    for (let i = 0; i < 3; i += 1) {
      expect(await execute({ id: node.id }, { toolCallId: 'old-video' })).toMatchObject({
        ok: false, status: 'error', jobId: first.jobId, jobStatus: 'cancelled',
      });
    }
    expect(budget.counts().execute).toBe(1);
    expect(store.jobs.current(canvasId, node.id)?.id).toBe(newer.job.id);
    expect(admissions).toHaveBeenCalledTimes(2);
  });

  it('Agent reports and refunds its matched failure after the node shows a later successful result', async () => {
    const { node, execute, store, canvasId, budget } = await fixture(type);
    const first = await execute({ id: node.id, wait: false }, { toolCallId: 'video-failed' });
    finish(first.jobId as string, 'failed');
    store.updateNode(canvasId, node.id, { runState: 'done', output: { assets: ['later.mp4'] } });
    await Promise.resolve();
    expect(budget.counts().execute).toBe(0);
    expect(await execute({ id: node.id }, { toolCallId: 'video-failed' })).toMatchObject({ ok: false, jobStatus: 'failed', error: `${type} failed` });
  });

  it('Graph treats superseded media as skipped even when its successor already succeeded', async () => {
    const { store, canvasId, node, start, providerStore } = await fixture(type);
    const events: Array<Record<string, unknown>> = [];
    const release = getCanvasChannel(canvasId).subscribe(({ event }) => { if (event.type === 'graph_run') events.push(event); });
    cleanup.push(release);
    const originalJobs: string[] = [];
    const graph = runGraph({ canvasStore: store, settingsStore, providerStore, dataRoot: '.', canvasId,
      onJob: ({ job }) => originalJobs.push(job.id) });
    expect(originalJobs).toHaveLength(1);
    const successor = start('manual-successor');
    finish(successor.job.id, 'succeeded');
    await graph;
    expect(store.getNode(canvasId, node.id)?.runState).toBe('done');
    expect(events.at(-1)).toMatchObject({ running: false, succeeded: 0, skipped: 1, outcome: 'error' });
  });

  it('Graph stop aborts its exact media job and does not claim the batch completed', async () => {
    const { store, canvasId, providerStore } = await fixture(type);
    const jobs: string[] = [];
    const graph = runGraph({ canvasStore: store, settingsStore, providerStore, dataRoot: '.', canvasId,
      onJob: ({ job }) => jobs.push(job.id) });
    expect(stopCanvasRun(canvasId, store)).toBe(true);
    await graph;
    expect(store.jobs.get(jobs[0])?.status).toBe('cancelled');
  });
});

describe('audio admission dependencies', () => {
  it('HTTP cannot acknowledge missing providerStore as an accepted audio job', async () => {
    const { post, store, canvasId } = await fixture('audio', false);
    expect((await post('missing-store')).status).toBe(400);
    expect(store.jobs.list(canvasId)).toEqual([]);
    expect(admissions).not.toHaveBeenCalled();
  });

  it('Agent does not charge or admit audio when its providerStore is missing', async () => {
    const { node, execute, store, canvasId, budget } = await fixture('audio', false);
    await expect(execute({ id: node.id, wait: false }, { toolCallId: 'missing-store' })).rejects.toMatchObject({ status: 400 });
    expect(store.jobs.list(canvasId)).toEqual([]);
    expect(budget.counts().execute).toBe(0);
    expect(admissions).not.toHaveBeenCalled();
  });

  it('a successor audio result cannot dispatch the original graph downstream video', async () => {
    const { store, canvasId, node, start, providerStore } = await fixture('audio');
    const downstream = store.addNode(canvasId, { type: 'video', x: 200, y: 0, w: 100, h: 100, params: { prompt: 'video with speech' } }).node;
    store.addEdge(canvasId, { sourceId: node.id, targetId: downstream.id, targetHandle: 'audio_in' });
    const graph = runGraph({ canvasStore: store, settingsStore, providerStore, dataRoot: '.', canvasId });
    const successor = start('manual-audio-successor');
    finish(successor.job.id, 'succeeded');
    await graph;
    expect(store.jobs.list(canvasId).filter((job) => job.nodeId === downstream.id)).toEqual([]);
    expect(store.getNode(canvasId, downstream.id)).toMatchObject({ runState: 'error', output: { error: 'Upstream node failed' } });
    expect(admissions).toHaveBeenCalledTimes(2);
  });
});
