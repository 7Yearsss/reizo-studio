import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNodeType } from '../../../shared/canvas';
import type { SettingsStore } from '../storage/settingsStore';
import type { ProviderStore } from '../storage/providerStore';
import { openDb, type DbHandle } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore, type CanvasStore } from '../storage/canvasStore';
import type { VideoJobStatus } from './videoDrivers';
import type { AudioJobResult } from './audioDrivers';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(), poll: vi.fn(), synthesize: vi.fn(), streamText: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('./videoDrivers', async (original) => ({ ...await original<typeof import('./videoDrivers')>(), getVideoDriver: () => ({ id: 'mock', submit: mocks.submit, poll: mocks.poll }) }));
vi.mock('./audioDrivers', () => ({ getAudioDriver: () => ({ id: 'mock', synthesize: mocks.synthesize }) }));
vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(), mkdir: mocks.mkdir, writeFile: mocks.writeFile,
}));
vi.mock('./assets', async (original) => ({
  ...await original<typeof import('./assets')>(),
  stageCanvasAssets: async (_root: string, canvasId: string, inputs: import('./assets').CanvasAssetFileInput[], signal?: AbortSignal) => {
    signal?.throwIfAborted();
    await mocks.mkdir();
    const files = [];
    for (const [index, input] of inputs.entries()) {
      await mocks.writeFile(input.name, input.bytes);
      signal?.throwIfAborted();
      files.push({ id: 'fixture-' + index, path: canvasId + '/' + input.name, byteSize: input.bytes.byteLength,
        contentHash: createHash('sha256').update(input.bytes).digest('hex'), mimeType: input.mimeType, kind: input.kind });
    }
    return { files, keep: (): void => undefined, discard: async (): Promise<void> => undefined };
  },
}));
vi.mock('ai', async (original) => ({
  ...await original<typeof import('ai')>(), streamText: mocks.streamText,
}));
vi.mock('../agent/provider/openai', () => ({ createOpenAiModel: () => ({}) }));

import { awaitVideoJob, getActiveJob, stopVideoJobsForStore, submitVideoJob } from './asyncJobManager';
import { runAudioNode } from './audioExecutor';
import { runAgentNode } from './agentExecutor';
import { runVideoNode } from './videoExecutor';
import { isCanvasRunning, runGraph, stopCanvasRunsForStore } from './graphExecutor';
import { stopCanvasWork } from './workLifecycle';
import * as assetFiles from './assets';
import { getCanvasChannel } from './channel';

const resources = new Map<DbHandle, CanvasStore>();
const settings = {
  get: async () => ({ activeProviderId: 'openai', providers: { openai: { apiKey: 'test', model: 'test-model' } } }),
} as unknown as SettingsStore;
const providers = {
  getByIdWithSecret: async () => ({ id: 'mock', category: 'audio', enabled: true, driverType: 'mock', sampleParams: {}, credentials: {} }),
  getPublicCatalog: async () => ({ defaultProviderByCategory: { audio: 'mock' }, providers: [] as Array<{ id: string }> }),
} as unknown as ProviderStore;

function deferred<T>() {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flushCallbacks() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

async function fixture(type: CanvasNodeType) {
  const handle = openDb(':memory:');
  const store = createCanvasStore(handle);
  resources.set(handle, store);
  const session = await createSqliteSessionStore(handle).create('shutdown', null, null);
  const canvas = store.ensureCanvas(session.id);
  const node = store.addNode(canvas.id, {
    type, x: 0, y: 0, w: 100, h: 100, params: { prompt: 'hello', instruction: 'critique' },
  }).node;
  const close = () => { handle.close(); resources.delete(handle); };
  const trackAccess = () => {
    const methods = [vi.spyOn(store, 'getNode'), vi.spyOn(store, 'getSnapshot'), vi.spyOn(store, 'getCanvas'),
      vi.spyOn(store, 'upstreamNodes'), vi.spyOn(store, 'updateNode')];
    return () => { for (const method of methods) expect(method).not.toHaveBeenCalled(); };
  };
  return { handle, store, canvasId: canvas.id, node, close, trackAccess };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.submit.mockResolvedValue({ taskId: 'video-task' });
  mocks.poll.mockResolvedValue({ status: 'processing', progress: 30 });
  mocks.synthesize.mockResolvedValue({ audioBuffer: Buffer.from('audio'), format: 'mp3' });
});
afterEach(() => {
  for (const [handle, store] of resources) {
    stopCanvasWork(store); stopCanvasRunsForStore(store); stopVideoJobsForStore(store); handle.close();
  }
  resources.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('legacy canvas work shutdown fences', () => {
  it.each(['submit', 'poll', 'poll-error', 'download', 'write'] as const)('ignores video %s completion after ownership is removed and SQLite closes', async (stage) => {
    vi.useFakeTimers();
    const f = await fixture('video');
    const paused = deferred<unknown>();
    const reached = deferred<void>();
    if (stage === 'submit') mocks.submit.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    else if (stage === 'poll' || stage === 'poll-error') mocks.poll.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    else if (stage === 'download') {
      mocks.poll.mockResolvedValueOnce({ status: 'succeed', videoUrl: 'https://example.test/video' });
      vi.stubGlobal('fetch', vi.fn(() => { reached.resolve(); return paused.promise; }));
    } else {
      mocks.poll.mockResolvedValueOnce({ status: 'succeed', videoBuffer: Buffer.from('video') });
      mocks.writeFile.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    }
    const submitting = submitVideoJob({
      canvasStore: f.store, settingsStore: settings, dataRoot: 'unused', canvasId: f.canvasId,
      nodeId: f.node.id, params: { prompt: 'hello' },
    });
    if (stage !== 'submit') { await submitting; vi.advanceTimersByTime(2_500); }
    await reached.promise;
    const completion = awaitVideoJob(f.canvasId, f.node.id);
    stopCanvasWork(f.store);
    stopVideoJobsForStore(f.store);
    const noLateAccess = f.trackAccess();
    f.close();
    if (stage === 'submit') paused.resolve({ taskId: 'late-task' });
    else if (stage === 'poll') paused.resolve({ status: 'succeed', videoBuffer: Buffer.from('late-video') } satisfies VideoJobStatus);
    else if (stage === 'poll-error') paused.reject(new Error('late poll error'));
    else if (stage === 'download') paused.resolve(new Response('late-video'));
    else paused.resolve(undefined);
    await submitting;
    await completion;
    await flushCallbacks();
    noLateAccess();
    expect(getActiveJob(f.canvasId, f.node.id)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('denies an old pending submission from replacing its newer video task', async () => {
    vi.useFakeTimers();
    const f = await fixture('video');
    const paused = deferred<{ taskId: string }>();
    const reached = deferred<void>();
    mocks.submit.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    const options = { canvasStore: f.store, settingsStore: settings, dataRoot: 'unused', canvasId: f.canvasId, nodeId: f.node.id, params: { prompt: 'hello' } };
    const old = submitVideoJob(options);
    await reached.promise;
    mocks.submit.mockResolvedValueOnce({ taskId: 'new-task' });
    await submitVideoJob(options);
    paused.resolve({ taskId: 'old-task' });
    await old;
    expect(getActiveJob(f.canvasId, f.node.id)?.taskId).toBe('new-task');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not cancel a replacement video submitted by a completion observer', async () => {
    vi.useFakeTimers();
    const f = await fixture('video');
    mocks.poll.mockResolvedValueOnce({ status: 'succeed', videoBuffer: Buffer.from('video') });
    const options = { canvasStore: f.store, settingsStore: settings, dataRoot: 'unused', canvasId: f.canvasId, nodeId: f.node.id, params: { prompt: 'hello' } };
    await submitVideoJob(options);
    const replaced = deferred<void>();
    const unsubscribe = getCanvasChannel(f.canvasId).subscribe(({ event }) => {
      if (event.type === 'node_output' && event.runState === 'done') {
        mocks.submit.mockResolvedValueOnce({ taskId: 'replacement-task' });
        void submitVideoJob(options).then(() => replaced.resolve());
      }
    });
    vi.advanceTimersByTime(2_500);
    await replaced.promise;
    unsubscribe();
    expect(getActiveJob(f.canvasId, f.node.id)?.taskId).toBe('replacement-task');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stopping one repository leaves another repository video timer and ownership active', async () => {
    vi.useFakeTimers();
    const first = await fixture('video');
    const second = await fixture('video');
    for (const f of [first, second]) await submitVideoJob({
      canvasStore: f.store, settingsStore: settings, dataRoot: 'unused', canvasId: f.canvasId, nodeId: f.node.id, params: { prompt: 'hello' },
    });
    stopCanvasWork(first.store);
    stopVideoJobsForStore(first.store);
    expect(getActiveJob(first.canvasId, first.node.id)).toBeUndefined();
    expect(getActiveJob(second.canvasId, second.node.id)).toBeDefined();
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(['success', 'error', 'write'] as const)('ignores late audio %s after SQLite closes', async (stage) => {
    const f = await fixture('audio');
    const paused = deferred<unknown>();
    const reached = deferred<void>();
    if (stage === 'write') mocks.writeFile.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    else mocks.synthesize.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    const running = runAudioNode({ canvasStore: f.store, providerStore: providers, providerId: 'mock', dataRoot: 'unused', canvasId: f.canvasId, node: f.node });
    await reached.promise;
    stopCanvasWork(f.store);
    const noLateAccess = f.trackAccess();
    f.close();
    if (stage === 'error') paused.reject(new Error('late synth error'));
    else if (stage === 'success') paused.resolve({ audioBuffer: Buffer.from('late'), format: 'mp3' } satisfies AudioJobResult);
    else paused.resolve(undefined);
    await running;
    noLateAccess();
  });

  it('preserves existing audio assets through rerun and successful completion', async () => {
    const f = await fixture('audio');
    f.store.updateNode(f.canvasId, f.node.id, { output: { assets: ['old.mp3'], resultSet: [{ asset: 'old.mp3' }] }, runState: 'done' });
    await runAudioNode({ canvasStore: f.store, providerStore: providers, providerId: 'mock', dataRoot: 'unused', canvasId: f.canvasId, node: f.node });
    const output = f.store.getNode(f.canvasId, f.node.id)?.output;
    expect(output?.assets).toHaveLength(2);
    expect(output?.assets?.[1]).toBe('old.mp3');
    expect(output?.resultSet?.[1]).toEqual({ asset: 'old.mp3' });
  });

  it('stops late agent deltas and read-only tool callbacks before they reach a closed database', async () => {
    const f = await fixture('agent');
    const paused = deferred<string>();
    const reached = deferred<void>();
    mocks.streamText.mockReturnValueOnce({
      textStream: (async function* () { reached.resolve(); yield await paused.promise; })(), text: Promise.resolve('late text'),
    });
    const running = runAgentNode({ canvasStore: f.store, settingsStore: settings, canvasId: f.canvasId, node: f.node });
    await reached.promise;
    const call = mocks.streamText.mock.calls[0][0] as { abortSignal: AbortSignal; tools: Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }> };
    stopCanvasWork(f.store);
    const noLateAccess = f.trackAccess();
    f.close();
    expect(call.abortSignal.aborted).toBe(true);
    expect(await call.tools.read_canvas.execute({})).toEqual({ error: 'Run stopped' });
    expect(await call.tools.read_node.execute({ id: f.node.id })).toEqual({ error: 'Run stopped' });
    paused.resolve('late delta');
    await running;
    noLateAccess();
  });

  it('fences video preflight asset reads before later canvas introspection after shutdown', async () => {
    const f = await fixture('video');
    const upstream = f.store.addNode(f.canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
    f.store.updateNode(f.canvasId, upstream.id, { output: { assets: ['upstream.png'] } });
    f.store.addEdge(f.canvasId, { sourceId: upstream.id, targetId: f.node.id, targetHandle: 'start_frame' });
    const paused = deferred<Buffer>();
    const reached = deferred<void>();
    vi.spyOn(assetFiles, 'readCanvasAsset').mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    const running = runVideoNode({ canvasStore: f.store, settingsStore: settings, dataRoot: 'unused', canvasId: f.canvasId, node: f.node });
    await reached.promise;
    stopCanvasWork(f.store);
    const noLateAccess = f.trackAccess();
    f.close();
    paused.resolve(Buffer.from('late reference'));
    await running;
    noLateAccess();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('removes graph ownership before abort and lets delayed node completion settle without final database reads', async () => {
    const f = await fixture('agent');
    const paused = deferred<string>();
    const reached = deferred<void>();
    mocks.streamText.mockReturnValueOnce({
      textStream: (async function* () { reached.resolve(); yield await paused.promise; })(), text: Promise.resolve('late text'),
    });
    const running = runGraph({ canvasStore: f.store, settingsStore: settings, dataRoot: 'unused', canvasId: f.canvasId });
    await reached.promise;
    expect(isCanvasRunning(f.canvasId)).toBe(true);
    stopCanvasWork(f.store);
    stopCanvasRunsForStore(f.store);
    expect(isCanvasRunning(f.canvasId)).toBe(false);
    const noLateAccess = f.trackAccess();
    f.close();
    paused.resolve('late delta');
    await running;
    noLateAccess();
  });
});
