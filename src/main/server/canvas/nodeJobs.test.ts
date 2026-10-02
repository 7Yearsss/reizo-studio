import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb, type DbHandle } from '../db/client';
import { createCanvasStore, type CanvasStore } from '../storage/canvasStore';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { nodeJobsFor, NodeJobsClosedError, type NodeJobContext, type NodeJobStartOptions } from './nodeJobs';
import { stopCanvasWork } from './workLifecycle';

const resources = new Map<DbHandle, CanvasStore>();
afterEach(() => {
  for (const [handle, store] of resources) { stopCanvasWork(store); handle.close(); }
  resources.clear();
  vi.restoreAllMocks();
});

async function fixture() {
  const handle = openDb(':memory:');
  const store = createCanvasStore(handle);
  resources.set(handle, store);
  const session = await createSqliteSessionStore(handle).create('media-runtime', null, null);
  const canvasId = store.ensureCanvas(session.id).id;
  const audio = store.addNode(canvasId, { type: 'audio', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'hello' } }).node;
  const image = store.addNode(canvasId, { type: 'image', x: 100, y: 0, w: 100, h: 100, params: { prompt: 'hello' } }).node;
  const runtime = nodeJobsFor(store);
  const request = (operationId: string, execute: NodeJobStartOptions['execute']): NodeJobStartOptions => ({
    canvasId, nodeId: audio.id, nodeType: 'audio', operationId,
    input: { request: { providerId: 'provider-a' }, params: { prompt: 'hello' } },
    execute, onCancelled: () => undefined,
  });
  return { handle, store, canvasId, audio, image, runtime, request };
}

describe('shared node job runtime', () => {
  it('replays an audio operation by its type and rejects cross-media identity reuse', async () => {
    const f = await fixture();
    const execute = vi.fn(async (job: NodeJobContext) => { job.finish('succeeded'); });
    const accepted = f.runtime.start(f.request('original-audio', execute));
    await accepted.completion;
    expect(f.runtime.replay(f.canvasId, f.audio.id, 'original-audio', 'provider-a', 'audio')?.job.id).toBe(accepted.job.id);
    expect(f.runtime.start(f.request('original-audio', execute)).job.id).toBe(accepted.job.id);
    expect(execute).toHaveBeenCalledOnce();
    expect(() => f.runtime.replay(f.canvasId, f.audio.id, 'original-audio', 'provider-a')).toThrow('different image request');
    expect(() => f.runtime.start({ ...f.request('original-audio', execute), nodeId: f.image.id, nodeType: 'image' })).toThrow('different image request');
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(1);
  });

  it('work revocation synchronously interrupts audio and resolves waiters before ignored work returns', async () => {
    const f = await fixture();
    let late!: NodeJobContext;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => {
      f.runtime.start(f.request('shutdown', async (job) => { late = job; resolve(); await pending; job.finish('succeeded'); }));
    });
    await started;
    expect(late.markSubmitted({ providerId: 'provider-a', model: 'actual-model' })).toBe(true);
    const accepted = f.runtime.replay(f.canvasId, f.audio.id, 'shutdown', 'provider-a', 'audio');
    stopCanvasWork(f.store);
    await accepted.completion;
    expect(f.store.jobs.get(late.id)).toMatchObject({ status: 'interrupted', cancelReason: 'host_shutdown' });
    expect(late.signal.aborted).toBe(true);
    expect(() => f.runtime.start(f.request('after-shutdown', async () => undefined))).toThrow(NodeJobsClosedError);
    const read = vi.spyOn(f.store.jobs, 'get');
    const current = vi.spyOn(f.store.jobs, 'isCurrent');
    f.handle.close(); resources.delete(f.handle);
    expect(late.isCurrent()).toBe(false);
    expect(late.finish('failed')).toBeNull();
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(read).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
  });

});
