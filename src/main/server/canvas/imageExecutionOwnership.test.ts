import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createCanvasApplication } from './application';
import { nodeJobsFor } from './nodeJobs';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateImage: generate }));
vi.mock('../agent/provider/openai', () => ({ createOpenAiProvider: () => ({ image: (id: string) => ({ id }) }) }));
import { canvasAssetsDir, runImageNode } from './imageExecutor';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const result = { images: [{ uint8Array: new Uint8Array(PNG), mediaType: 'image/png' }] };
const settingsStore = { get: async () => ({
  activeProviderId: 'openai', providers: { openai: { apiKey: 'test', baseUrl: 'https://example.test/v1' } },
}) } as unknown as SettingsStore;

function deferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
beforeEach(() => generate.mockReset());

async function fixture() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvas = createCanvasStore(handle);
  const session = await sessions.create('s', null, null);
  const canvasId = canvas.ensureCanvas(session.id).id;
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-image-jobs-'));
  const node = canvas.addNode(canvasId, {
    type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'first', size: '1024x1024' },
  }).node;
  cleanups.push(async () => {
    nodeJobsFor(canvas).cancelCanvas(canvasId);
    handle.close();
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { canvas, canvasId, dataRoot, node, run: (signal?: AbortSignal) => runImageNode({
    canvasStore: canvas, settingsStore, dataRoot, canvasId, node, signal,
  }) };
}

describe('image execution ownership', () => {
  it('a superseded request cannot overwrite the newer result or create an unused file', async () => {
    const { canvas, canvasId, dataRoot, node, run } = await fixture();
    const old = deferred<typeof result>();
    const started = deferred<void>();
    generate.mockImplementationOnce(() => { started.resolve(); return old.promise; });
    const first = run();
    await started.promise;
    canvas.updateNode(canvasId, node.id, { params: { prompt: 'second', size: '1024x1024' } });
    generate.mockResolvedValueOnce(result);
    await run();
    await first;
    const newest = canvas.getNode(canvasId, node.id);
    old.resolve(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canvas.getNode(canvasId, node.id)?.output).toEqual(newest?.output);
    expect(newest?.output?.resultSet?.[0]?.prompt).toBe('second');
    expect(newest?.output?.resultSet?.[0]?.model).toBe('gpt-image-2');
    expect(await readdir(canvasAssetsDir(dataRoot, canvasId))).toHaveLength(1);
  });

  it('abort releases the caller even when a provider ignores its signal', async () => {
    const { canvas, canvasId, node, run } = await fixture();
    const pending = deferred<typeof result>();
    const started = deferred<void>();
    generate.mockImplementationOnce(() => { started.resolve(); return pending.promise; });
    const abort = new AbortController();
    const running = run(abort.signal);
    await started.promise;
    expect(generate.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
    abort.abort();
    await running;
    expect(canvas.getNode(canvasId, node.id)?.runState).toBe('idle');
    pending.reject(new Error('late failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canvas.getNode(canvasId, node.id)?.output?.error).toBeUndefined();
  });

  it('deleting an in-flight node revokes its result and releases its caller', async () => {
    const { canvas, canvasId, dataRoot, node, run } = await fixture();
    const pending = deferred<typeof result>();
    const started = deferred<void>();
    generate.mockImplementationOnce(() => { started.resolve(); return pending.promise; });
    const running = run();
    await started.promise;
    createCanvasApplication(canvas).deleteNode(canvasId, node.id);
    await running;
    pending.resolve(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canvas.getNode(canvasId, node.id)).toBeNull();
    expect(await readdir(canvasAssetsDir(dataRoot, canvasId)).catch((): string[] => [])).toEqual([]);
  });

  it('an edit during generation keeps the output attached to its original input hash', async () => {
    const { canvas, canvasId, node, run } = await fixture();
    const pending = deferred<typeof result>();
    const started = deferred<void>();
    generate.mockImplementationOnce(() => { started.resolve(); return pending.promise; });
    const running = run();
    await started.promise;
    createCanvasApplication(canvas).updateNode(canvasId, node.id, { params: { prompt: 'changed', size: '1024x1024' } });
    pending.resolve(result);
    await running;
    const current = canvas.getSnapshot(canvasId)?.nodes.find((n) => n.id === node.id);
    expect(current?.params).toMatchObject({ prompt: 'changed' });
    expect(current?.output?.resultSet?.[0]?.prompt).toBe('first');
    expect(current?.dirty).toBe(true);
  });

  it('cancelling a rerun preserves the previous generated asset', async () => {
    const { canvas, canvasId, dataRoot, node, run } = await fixture();
    generate.mockResolvedValueOnce(result);
    await run();
    const original = canvas.getNode(canvasId, node.id)?.output?.assets?.[0];
    const pending = deferred<typeof result>();
    const started = deferred<void>();
    generate.mockImplementationOnce(() => { started.resolve(); return pending.promise; });
    const running = run();
    await started.promise;
    nodeJobsFor(canvas).cancelCanvas(canvasId);
    await running;
    pending.resolve(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canvas.getNode(canvasId, node.id)?.output?.assets?.[0]).toBe(original);
    expect(await readFile(path.join(dataRoot, 'canvas', original))).toEqual(PNG);
  });
});
