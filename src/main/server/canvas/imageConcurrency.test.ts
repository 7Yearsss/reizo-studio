import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasNode } from '../../../shared/canvas';
import { generationSchedulerFor } from './generationScheduler';
import { nodeJobsFor } from './nodeJobs';
import { stopCanvasWork } from './workLifecycle';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateImage: generate }));
vi.mock('../agent/provider/openai', () => ({ createOpenAiProvider: ({ apiKey }: { apiKey: string }) => ({ image: (id: string) => ({ id, provider: apiKey }) }) }));
import { canvasAssetsDir, startImageNode } from './imageExecutor';

const image = { images: [{ uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { generate.mockReset(); });
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(limits = { globalLimit: 2, providerLimit: 1 }) {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvasStore = createCanvasStore(handle);
  const makeCanvas = async () => canvasStore.ensureCanvas((await sessions.create('concurrency', null, null)).id).id;
  const canvasId = await makeCanvas();
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-image-concurrency-'));
  const get = vi.fn(async () => ({ activeProviderId: 'openai', providers: {
    openai: { apiKey: 'openai', baseUrl: 'https://example.test/v1' },
    reizo: { apiKey: 'reizo', baseUrl: 'https://example.test/v1' },
  } }));
  const settingsStore = { get } as unknown as SettingsStore;
  const scheduler = generationSchedulerFor(canvasStore, limits);
  let closed = false;
  const close = () => { handle.close(); closed = true; };
  cleanups.push(async () => {
    if (!closed) { stopCanvasWork(canvasStore); nodeJobsFor(canvasStore).shutdown(); close(); }
    if (!path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Temporary test directory escaped its root');
    await rm(dataRoot, { recursive: true, force: true });
  });
  const add = (prompt: string, count = 1, targetCanvas = canvasId) => canvasStore.addNode(targetCanvas, {
    type: 'image', x: 0, y: 0, w: 320, h: 380, params: { prompt, size: '1024x1024', count },
  }).node;
  const start = (node: CanvasNode, providerId = 'openai', signal?: AbortSignal) => startImageNode({
    canvasStore, settingsStore, dataRoot, canvasId: node.canvasId, node, providerId, signal,
  });
  return { canvasStore, canvasId, dataRoot, get, scheduler, makeCanvas, add, start, close };
}

describe('image admission uses the shared generation scheduler', () => {
  it('an image waits for a permit held by video on the same repository and provider before being submitted', async () => {
    const { scheduler, canvasStore, get, add, start } = await fixture();
    // Videos acquire this exact permit before submit and hold it through their polling lifecycle.
    const videoPermit = await scheduler.acquire('openai');
    generate.mockResolvedValue(image);
    const accepted = start(add('waiting behind video'));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(generate).not.toHaveBeenCalled();
    expect(canvasStore.jobs.get(accepted.job.id)).toMatchObject({ status: 'queued' });
    expect(canvasStore.jobs.get(accepted.job.id)?.submittedAt).toBeUndefined();
    videoPermit();
    await accepted.completion;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(canvasStore.jobs.get(accepted.job.id)).toMatchObject({ status: 'succeeded', providerId: 'openai', submittedAt: expect.any(String) });
  });

  it('shares global and provider limits across separate canvases and lets an eligible provider bypass a blocked one', async () => {
    const { canvasStore, add, start, makeCanvas } = await fixture();
    const otherCanvas = await makeCanvas();
    const pending: Array<ReturnType<typeof deferred<typeof image>>> = [];
    const runningByProvider = new Map<string, number>();
    const maximum = new Map<string, number>();
    let active = 0; let globalMaximum = 0;
    generate.mockImplementation((options: { model: { provider: string } }) => {
      const provider = options.model.provider;
      active += 1; globalMaximum = Math.max(globalMaximum, active);
      const count = (runningByProvider.get(provider) ?? 0) + 1;
      runningByProvider.set(provider, count); maximum.set(provider, Math.max(maximum.get(provider) ?? 0, count));
      const completion = deferred<typeof image>(); pending.push(completion);
      return completion.promise.finally(() => { active -= 1; runningByProvider.set(provider, (runningByProvider.get(provider) ?? 1) - 1); });
    });
    const a1 = start(add('a1'));
    const a2 = start(add('a2', 1, otherCanvas));
    const b1 = start(add('b1'), 'reizo');
    const b2 = start(add('b2', 1, otherCanvas), 'reizo');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls.map(([args]) => args.prompt)).toEqual(['a1', 'b1']);
    expect(canvasStore.jobs.get(a2.job.id)?.submittedAt).toBeUndefined();
    expect(canvasStore.jobs.get(b2.job.id)?.submittedAt).toBeUndefined();
    pending[1].resolve(image);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    expect(generate.mock.calls[2][0].prompt).toBe('b2');
    pending[0].resolve(image);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(4));
    expect(generate.mock.calls[3][0].prompt).toBe('a2');
    pending[2].resolve(image); pending[3].resolve(image);
    await Promise.all([a1.completion, a2.completion, b1.completion, b2.completion]);
    expect(globalMaximum).toBe(2);
    expect([...maximum.values()]).toEqual([1, 1]);
  });

  it('each variation uses its own permit and the result commits only after all admitted calls finish', async () => {
    const { canvasStore, add, start } = await fixture();
    const pending: Array<ReturnType<typeof deferred<typeof image>>> = [];
    let active = 0; let maximum = 0;
    generate.mockImplementation(() => {
      active += 1; maximum = Math.max(maximum, active);
      const completion = deferred<typeof image>(); pending.push(completion);
      return completion.promise.finally(() => { active -= 1; });
    });
    const accepted = start(add('four variants', 4));
    for (let index = 0; index < 4; index += 1) {
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(index + 1));
      expect(canvasStore.jobs.get(accepted.job.id)?.status).toBe('running');
      pending[index].resolve(image);
    }
    await accepted.completion;
    expect(maximum).toBe(1);
    expect(canvasStore.jobs.get(accepted.job.id)?.status).toBe('succeeded');
    expect(canvasStore.getNode(accepted.job.canvasId, accepted.job.nodeId)?.output?.assets).toHaveLength(4);
    expect(generate.mock.calls.every(([args]) => args.maxRetries === 0)).toBe(true);
  });

  it('cancelling a queued image never submits it when another task later releases its permit', async () => {
    const { scheduler, canvasStore, get, add, start } = await fixture({ globalLimit: 1, providerLimit: 1 });
    const held = await scheduler.acquire('openai');
    const abort = new AbortController();
    const cancelled = start(add('cancelled waiter'), 'openai', abort.signal);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    abort.abort();
    await cancelled.completion;
    expect(canvasStore.jobs.get(cancelled.job.id)).toMatchObject({ status: 'cancelled' });
    expect(canvasStore.jobs.get(cancelled.job.id)?.submittedAt).toBeUndefined();
    generate.mockResolvedValue(image);
    held();
    const next = start(add('next owner'));
    await next.completion;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].prompt).toBe('next owner');
  });

  it('the first failed variation revokes queued sibling requests before any more paid calls', async () => {
    const { canvasStore, add, start } = await fixture({ globalLimit: 1, providerLimit: 1 });
    generate.mockRejectedValueOnce(new Error('HTTP 429 rate limited'));
    const failed = start(add('failing batch', 4));
    await failed.completion;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(canvasStore.jobs.get(failed.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/限流/) });
    expect(canvasStore.getNode(failed.job.canvasId, failed.job.nodeId)?.runState).toBe('error');
    generate.mockResolvedValue(image);
    const next = start(add('next after failure'));
    await next.completion;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(canvasStore.jobs.get(next.job.id)?.status).toBe('succeeded');
  });

  it('a failed variation releases active ignoring siblings while preserving the failed batch outcome', async () => {
    const { canvasStore, canvasId, dataRoot, add, start } = await fixture({ globalLimit: 4, providerLimit: 4 });
    const pending = Array.from({ length: 4 }, () => deferred<typeof image>());
    let index = 0;
    generate.mockImplementation(() => pending[index++].promise);
    const failed = start(add('active failing batch', 4));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(4));
    pending[0].reject(new Error('HTTP 429 rate limited'));
    await failed.completion;
    expect(canvasStore.jobs.get(failed.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/限流/) });
    generate.mockResolvedValue(image);
    const next = start(add('next owner'));
    await next.completion;
    expect(generate).toHaveBeenCalledTimes(5);
    expect(canvasStore.jobs.get(next.job.id)?.status).toBe('succeeded');
    pending.slice(1).forEach((completion) => completion.resolve(image));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canvasStore.getNode(canvasId, failed.job.nodeId)?.output?.assets).toBeUndefined();
    expect(await readdir(canvasAssetsDir(dataRoot, canvasId))).toHaveLength(1);
  });

  it('cancellation frees an active image permit even for an ignoring provider and its late result cannot overwrite the next job', async () => {
    const { canvasStore, canvasId, dataRoot, add, start } = await fixture({ globalLimit: 1, providerLimit: 1 });
    const oldProvider = deferred<typeof image>();
    generate.mockReturnValueOnce(oldProvider.promise).mockResolvedValueOnce(image);
    const abort = new AbortController();
    const first = start(add('old owner'), 'openai', abort.signal);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const next = start(add('next owner'));
    abort.abort();
    await Promise.all([first.completion, next.completion]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(canvasStore.jobs.get(first.job.id)?.status).toBe('cancelled');
    expect(canvasStore.jobs.get(next.job.id)?.status).toBe('succeeded');
    oldProvider.resolve(image);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canvasStore.getNode(canvasId, first.job.nodeId)?.output?.assets).toBeUndefined();
    expect(await readdir(canvasAssetsDir(dataRoot, canvasId))).toHaveLength(1);
  });

  it('host shutdown closes admission, interrupts both active and queued images, and rejects late work after DB close', async () => {
    const { canvasStore, scheduler, get, add, start, close } = await fixture({ globalLimit: 1, providerLimit: 1 });
    const pending = deferred<typeof image>(); generate.mockReturnValue(pending.promise);
    const running = start(add('running image'));
    const waiting = start(add('queued image'));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    stopCanvasWork(canvasStore);
    nodeJobsFor(canvasStore).shutdown();
    expect(scheduler.isAccepting()).toBe(false);
    expect(canvasStore.jobs.get(running.job.id)?.status).toBe('interrupted');
    expect(canvasStore.jobs.get(waiting.job.id)?.status).toBe('interrupted');
    expect(canvasStore.jobs.get(waiting.job.id)?.submittedAt).toBeUndefined();
    await Promise.all([running.completion, waiting.completion]);
    close();
    const read = vi.spyOn(canvasStore, 'getNode');
    pending.resolve(image);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(read).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('Gemini chat image requests use the same admission limits as SDK image requests', async () => {
    const { canvasStore, scheduler, get, add, start } = await fixture({ globalLimit: 1, providerLimit: 1 });
    const node = add('Gemini image');
    canvasStore.updateNode(node.canvasId, node.id, { params: { prompt: 'Gemini image', size: '1024x1024', model: 'gemini-3.1-flash-image' } });
    const held = await scheduler.acquire('openai');
    const fetch = vi.fn(async () => Response.json({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,AQID' } }] } }] }));
    vi.stubGlobal('fetch', fetch);
    const accepted = start(node);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
    held();
    await accepted.completion;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(canvasStore.jobs.get(accepted.job.id)?.status).toBe('succeeded');
  });
});
