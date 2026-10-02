import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import type { ProviderStore } from '../storage/providerStore';
import type { CanvasEvent } from '../../../shared/canvasStream';
import type { CanvasNode } from '../../../shared/canvas';
import { inputHash } from './graph';

const generate = vi.hoisted(() => vi.fn());
const broadcast = vi.hoisted(() => vi.fn());
vi.mock('./imageExecutor', () => ({
  runImageNode: generate, readCanvasAsset: vi.fn(), broadcastDownstreamDirty: vi.fn(),
  startImageNode: (options: { canvasStore: ReturnType<typeof createCanvasStore>; canvasId: string; node: CanvasNode; operationId: string; signal: AbortSignal }) => {
    const { canvasStore: store, canvasId, node } = options;
    const job = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', operationId: options.operationId, input: {} });
    store.updateNode(canvasId, node.id, { runState: 'running' });
    const completion = Promise.resolve(generate(options)).then(() => {
      const state = store.getNode(canvasId, node.id)?.runState;
      store.jobs.finish(job.id, options.signal.aborted ? 'cancelled' : state === 'done' ? 'succeeded' : 'failed');
    });
    return { job, completion };
  },
}));
vi.mock('./channel', () => ({ getCanvasChannel: () => ({ broadcast }) }));
import { isCanvasRunning, runGraph, stopCanvasRun } from './graphExecutor';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0)) fn(); });
beforeEach(() => { generate.mockReset(); broadcast.mockReset(); });
const settings = {} as SettingsStore;
async function setup() {
  const handle = openDb(':memory:');
  cleanups.push(() => handle.close());
  const session = await createSqliteSessionStore(handle).create('s', null, null);
  const canvasStore = createCanvasStore(handle);
  const canvasId = canvasStore.ensureCanvas(session.id).id;
  const add = (prompt: string) => canvasStore.addNode(canvasId, {
    type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt },
  }).node;
  return { canvasStore, canvasId, add, run: () => runGraph({ canvasStore, canvasId, settingsStore: settings, dataRoot: '.' }) };
}
function terminals() {
  return broadcast.mock.calls.map((call) => call[1] as CanvasEvent)
    .filter((event) => event.type === 'graph_run' && !event.running);
}

describe('graph execution outcomes', () => {
  it('reports a failed generation and skipped downstream separately, preserving prior assets', async () => {
    const { canvasStore, canvasId, add, run } = await setup();
    const first = add('parent');
    const child = add('child');
    canvasStore.updateNode(canvasId, child.id, { output: { assets: ['previous.png'] } });
    canvasStore.addEdge(canvasId, { sourceId: first.id, targetId: child.id });
    generate.mockImplementation(async ({ node }: { node: CanvasNode }) => {
      canvasStore.updateNode(canvasId, node.id, { runState: 'error', output: { error: 'provider failed' } });
    });
    await run();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(canvasStore.getNode(canvasId, child.id)?.output?.assets).toEqual(['previous.png']);
    expect(terminals()).toEqual([expect.objectContaining({ done: 2, total: 2, succeeded: 0, failed: 1, skipped: 1, outcome: 'error' })]);
  });

  it('cache hits have an accurate nonnegative count', async () => {
    const { canvasStore, canvasId, add, run } = await setup();
    const node = add('cached');
    canvasStore.updateNode(canvasId, node.id, { runState: 'done', paramsHash: inputHash(node, []), output: { assets: ['existing.png'] } });
    await run();
    expect(generate).not.toHaveBeenCalled();
    expect(terminals()).toEqual([expect.objectContaining({ done: 1, failed: 0, skipped: 1, outcome: 'completed' })]);
  });

  it('marks a video dirty and admits a new job when its upstream selected version changes', async () => {
    const { canvasStore, canvasId, add, run } = await setup();
    const source = add('reference');
    const assets = ['draft.png', 'refined.png'];
    canvasStore.updateNode(canvasId, source.id, { runState: 'done', paramsHash: inputHash(source, []), output: { assets } });
    const video = canvasStore.addNode(canvasId, { type: 'video', x: 200, y: 0, w: 100, h: 100, params: { prompt: 'Animate selected frame' } }).node;
    canvasStore.addEdge(canvasId, { sourceId: source.id, targetId: video.id, targetHandle: 'start_frame' });
    canvasStore.updateNode(canvasId, video.id, { runState: 'done', paramsHash: inputHash(video, [canvasStore.getNode(canvasId, source.id)]), output: { assets: ['cached.mp4'] } });
    await run();
    expect(canvasStore.jobs.list(canvasId)).toEqual([]);
    expect(canvasStore.getSnapshot(canvasId)?.nodes.find((node) => node.id === video.id)?.dirty).toBe(false);
    canvasStore.updateNode(canvasId, source.id, { output: { assets, activeAssetIndex: 1 } });
    expect(canvasStore.getSnapshot(canvasId)?.nodes.find((node) => node.id === video.id)?.dirty).toBe(true);
    const jobs: string[] = [];
    const rerun = runGraph({ canvasStore, canvasId, settingsStore: settings, dataRoot: '.', nodeIds: [video.id], onJob: ({ job }) => jobs.push(job.id) });
    expect(jobs).toHaveLength(1);
    expect(canvasStore.jobs.get(jobs[0])?.nodeId).toBe(video.id);
    stopCanvasRun(canvasId, canvasStore);
    await rerun;
    expect(generate).not.toHaveBeenCalled();
  });

  it('marks cached audio dirty and admits its narration again after an upstream note is edited', async () => {
    const { canvasStore, canvasId } = await setup();
    const note = canvasStore.addNode(canvasId, { type: 'note', x: 0, y: 0, w: 100, h: 100, params: { content: 'Original narration' } }).node;
    const audio = canvasStore.addNode(canvasId, { type: 'audio', x: 200, y: 0, w: 100, h: 100, params: { prompt: '' } }).node;
    canvasStore.addEdge(canvasId, { sourceId: note.id, targetId: audio.id, targetHandle: 'prompt' });
    canvasStore.updateNode(canvasId, audio.id, { runState: 'done', paramsHash: inputHash(audio, [note]), output: { assets: ['cached.mp3'] } });
    const providerStore = {} as ProviderStore;
    canvasStore.updateNode(canvasId, note.id, { title: 'Renamed script', x: 300 });
    expect(canvasStore.getSnapshot(canvasId)?.nodes.find((node) => node.id === audio.id)?.dirty).toBe(false);
    await runGraph({ canvasStore, canvasId, settingsStore: settings, providerStore, dataRoot: '.', nodeIds: [audio.id] });
    expect(canvasStore.jobs.list(canvasId)).toEqual([]);
    expect(canvasStore.getSnapshot(canvasId)?.nodes.find((node) => node.id === audio.id)?.dirty).toBe(false);
    canvasStore.updateNode(canvasId, note.id, { params: { content: 'Revised narration' } });
    expect(canvasStore.getSnapshot(canvasId)?.nodes.find((node) => node.id === audio.id)?.dirty).toBe(true);
    const jobs: string[] = [];
    const rerun = runGraph({ canvasStore, canvasId, settingsStore: settings, providerStore, dataRoot: '.', nodeIds: [audio.id], onJob: ({ job }) => jobs.push(job.id) });
    expect(jobs).toHaveLength(1);
    expect(canvasStore.jobs.get(jobs[0])?.input.prompt).toBe('Revised narration');
    stopCanvasRun(canvasId, canvasStore);
    await rerun;
    expect(canvasStore.jobs.get(jobs[0])?.submittedAt).toBeUndefined();
  });

  it('stop propagates the abort signal and does not claim all nodes completed', async () => {
    const { canvasStore, canvasId, add, run } = await setup();
    const parent = add('parent');
    const child = add('child');
    canvasStore.addEdge(canvasId, { sourceId: parent.id, targetId: child.id });
    let started: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    generate.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
      started();
    }));
    const running = run();
    await ready;
    expect(stopCanvasRun(canvasId)).toBe(true);
    await running;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(isCanvasRunning(canvasId)).toBe(false);
    expect(terminals()).toEqual([expect.objectContaining({ done: 0, total: 2, outcome: 'cancelled' })]);
  });

  it('an older run cannot publish a terminal event for its replacement', async () => {
    const { canvasStore, canvasId, add, run } = await setup();
    add('product');
    let releaseOld: () => void;
    generate.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseOld = resolve; }));
    const first = run();
    generate.mockImplementationOnce(async ({ node }: { node: CanvasNode }) => {
      canvasStore.updateNode(canvasId, node.id, { runState: 'done' });
    });
    await run();
    releaseOld();
    await first;
    expect(terminals()).toHaveLength(1);
    expect(terminals()[0]).toMatchObject({ outcome: 'completed', succeeded: 1 });
  });
});
