import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createCanvasBudget } from './canvasBudget';
import { nodeJobsFor } from '../canvas/nodeJobs';
import { stopCanvasWork } from '../canvas/workLifecycle';
import { startImageNode } from '../canvas/imageExecutor';
import { createCanvasTools } from './canvasTools';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateImage: generate }));
vi.mock('../agent/provider/openai', () => ({ createOpenAiProvider: () => ({ image: (id: string) => ({ id }) }) }));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const result = { images: [{ uint8Array: new Uint8Array(PNG), mediaType: 'image/png' }] };
const settingsStore = { get: async () => ({ activeProviderId: 'openai', providers: { openai: { apiKey: 'test', baseUrl: 'https://example.test/v1' } } }) } as unknown as SettingsStore;
const cleanups: Array<() => Promise<void>> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => { generate.mockReset(); });
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

async function fixture() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('agent-jobs', null, null);
  const store = createCanvasStore(handle);
  const canvasId = store.ensureCanvas(session.id).id;
  const node = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'original' } }).node;
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-agent-job-'));
  const budget = createCanvasBudget({ execute: 1 });
  const { tools } = createCanvasTools({ sessionId: session.id, canvasStore: store, settingsStore, dataRoot, budget });
  const execute = tools.run_node.execute as unknown as (input: { id: string; wait?: boolean; timeoutMs?: number; operationId?: string },
    options: { toolCallId: string }) => Promise<Record<string, unknown>>;
  let closed = false;
  const stop = () => { stopCanvasWork(store); nodeJobsFor(store).shutdown(); };
  const close = () => { handle.close(); closed = true; };
  cleanups.push(async () => {
    if (!closed) { stop(); close(); }
    if (!path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Test path escaped temporary root');
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { store, canvasId, node, budget, execute, tools, stop, close,
    start: (operationId?: string) => startImageNode({ canvasStore: store, settingsStore, dataRoot, canvasId, node, operationId }) };
}

describe('Agent durable image consumers', () => {
  it('replays the original outcome before fuse and quota checks without another submission or charge', async () => {
    const { store, canvasId, node, budget, execute } = await fixture();
    generate.mockResolvedValue(result);
    const first = await execute({ id: node.id }, { toolCallId: 'original-call' });
    expect(first).toMatchObject({ ok: true, status: 'done', jobStatus: 'succeeded', jobId: expect.any(String) });
    expect(budget.counts().execute).toBe(1);
    store.updateNode(canvasId, node.id, { params: { prompt: 'edited after completion' } });
    for (let i = 0; i < 3; i += 1) {
      expect(await execute({ id: node.id }, { toolCallId: 'original-call' })).toEqual(first);
    }
    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.jobs.list(canvasId)).toHaveLength(1);
    expect(budget.counts().execute).toBe(1);
  });

  it('returns an older cancelled job instead of waiting for or reporting a successor', async () => {
    const { store, canvasId, node, execute, start, budget } = await fixture();
    const oldProvider = deferred<typeof result>();
    const newProvider = deferred<typeof result>();
    generate.mockReturnValueOnce(oldProvider.promise).mockReturnValueOnce(newProvider.promise);
    const first = await execute({ id: node.id, wait: false }, { toolCallId: 'old-call' });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    store.updateNode(canvasId, node.id, { params: { prompt: 'successor' } });
    const newer = start('new-call');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    const replay = await execute({ id: node.id, timeoutMs: 50_000 }, { toolCallId: 'old-call' });
    expect(replay).toMatchObject({ ok: false, status: 'error', jobId: first.jobId, jobStatus: 'cancelled', error: expect.stringContaining('superseded') });
    expect(store.jobs.current(canvasId, node.id)?.id).toBe(newer.job.id);
    expect(generate.mock.calls[1][0].abortSignal.aborted).toBe(false);
    expect(budget.counts().execute).toBe(1);
    newProvider.resolve(result);
    await newer.completion;
    oldProvider.resolve(result);
  });

  it('uses explicit operation identity and retains a deleted node job receipt', async () => {
    const { store, canvasId, node, execute } = await fixture();
    generate.mockResolvedValue(result);
    const first = await execute({ id: node.id, operationId: 'explicit' }, { toolCallId: 'first-call' });
    store.deleteNode(canvasId, node.id);
    const replay = await execute({ id: node.id, operationId: 'explicit' }, { toolCallId: 'another-call' });
    expect(replay).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('assigns storyboard auto runs a separate durable node-scoped operation', async () => {
    const { tools, store, canvasId } = await fixture();
    generate.mockReturnValue(new Promise<void>(() => undefined));
    const input = { storyTitle: 'Storyboard', ratio: '16:9', scenes: [
      { title: 'Scene', script: 'Script', imagePrompt: 'Image', videoPrompt: 'Motion', camera: 'none', duration: '5s' },
    ], autoRunFirstScene: true, operationId: 'storyboard-request' };
    const execute = tools.create_storyboard_pipeline.execute as unknown as (input: unknown, options: unknown) => Promise<Record<string, unknown>>;
    const first = await execute(input, { toolCallId: 'pipeline-call' });
    const job = store.jobs.list(canvasId)[0];
    expect(job.operationId).toBe(`storyboard-request:image:${job.nodeId}`);
    await execute(input, { toolCallId: 'pipeline-replay' });
    expect(store.jobs.list(canvasId)).toHaveLength(1);
    expect(first.createdNodeIds).toContain(job.nodeId);
  });

  it('refunds the matched failed ledger rather than a newer successful node projection', async () => {
    const { store, canvasId, node, execute, budget } = await fixture();
    const pending = deferred<typeof result>();
    generate.mockReturnValue(pending.promise);
    const accepted = await execute({ id: node.id, wait: false }, { toolCallId: 'failure-call' });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const done = deferred<void>();
    const release = store.subscribeCommits(() => {
      if (store.jobs.get(accepted.jobId as string)?.status !== 'failed') return;
      release();
      store.updateNode(canvasId, node.id, { runState: 'done', output: { assets: ['newer.png'] } });
      done.resolve();
    });
    pending.reject(new Error('HTTP 429 rate limited'));
    await done.promise;
    await vi.waitFor(() => expect(budget.counts().execute).toBe(0));
    expect(store.getNode(canvasId, node.id)?.runState).toBe('done');
    const replay = await execute({ id: node.id }, { toolCallId: 'failure-call' });
    expect(replay).toMatchObject({ ok: false, jobStatus: 'failed', status: 'error' });
  });

  it('clears the deadline after a completed image wait', async () => {
    const { node, execute } = await fixture();
    vi.useFakeTimers();
    generate.mockResolvedValue(result);
    expect(await execute({ id: node.id, timeoutMs: 50_000 }, { toolCallId: 'fast-call' })).toMatchObject({ status: 'done' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a durable pending identity on timeout without resubmitting', async () => {
    const { node, execute, store } = await fixture();
    vi.useFakeTimers();
    generate.mockReturnValue(new Promise<void>(() => undefined));
    const waiting = execute({ id: node.id, timeoutMs: 50 }, { toolCallId: 'slow-call' });
    await vi.advanceTimersByTimeAsync(50);
    const timedOut = await waiting;
    expect(timedOut).toMatchObject({ status: 'running', jobStatus: 'running', jobId: expect.any(String) });
    expect(store.jobs.get(timedOut.jobId as string)?.status).toBe('running');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts waits and completion refunds before a host closes the database', async () => {
    const { node, execute, store, tools, stop, close } = await fixture();
    const pending = deferred<typeof result>();
    generate.mockReturnValue(pending.promise);
    const waiting = execute({ id: node.id }, { toolCallId: 'quit-call' });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    stop();
    close();
    const read = vi.spyOn(store.jobs, 'get');
    expect(await waiting).toMatchObject({ status: 'error', jobStatus: 'interrupted' });
    pending.resolve(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(read).not.toHaveBeenCalled();
    await expect((tools.open_canvas.execute as () => Promise<unknown>)()).rejects.toMatchObject({ status: 503 });
  });
});
