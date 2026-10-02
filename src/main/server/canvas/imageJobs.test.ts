import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { serializeMention } from '../../../shared/resolveMentions';
import { nodeJobsFor } from './nodeJobs';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateImage: generate }));
vi.mock('../agent/provider/openai', () => ({ createOpenAiProvider: () => ({ image: (id: string) => ({ id }) }) }));
import { canvasAssetsDir, startImageNode } from './imageExecutor';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const result = { images: [{ uint8Array: new Uint8Array(PNG), mediaType: 'image/png' }] };
const settings = { activeProviderId: 'openai', providers: { openai: { apiKey: 'never-persist-this-key', baseUrl: 'https://example.test/v1' } } };
const cleanups: Array<() => Promise<void>> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => { generate.mockReset(); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(prompt = 'first') {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvas = createCanvasStore(handle);
  const session = await sessions.create('s', null, null);
  const canvasId = canvas.ensureCanvas(session.id).id;
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-durable-images-'));
  const node = canvas.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt, size: '1024x1024' } }).node;
  const settingsStore = { get: vi.fn(async () => settings) } as unknown as SettingsStore;
  let closed = false;
  const closeDb = () => { handle.close(); closed = true; };
  cleanups.push(async () => {
    if (!closed) { nodeJobsFor(canvas).shutdown(); closeDb(); }
    if (!path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Temporary test directory escaped its root');
    await rm(dataRoot, { recursive: true, force: true });
  });
  const options = { canvasStore: canvas, settingsStore, dataRoot, canvasId, node };
  return { ...options, canvas, options, closeDb, start: (operationId?: string, signal?: AbortSignal) => startImageNode({ ...options, operationId, signal }) };
}

describe('durable image jobs', () => {
  it('persists admission synchronously, submits provider metadata before billing and commits result with the node', async () => {
    const { canvas, canvasId, node, start } = await fixture();
    generate.mockImplementation(() => {
      expect(canvas.jobs.current(canvasId, node.id)).toMatchObject({ status: 'running', providerId: 'openai', model: 'gpt-image-2', submittedAt: expect.any(String) });
      return Promise.resolve(result);
    });
    const accepted = start('first-operation');
    expect(canvas.jobs.get(accepted.job.id)).toMatchObject({ status: 'queued', generation: 1, operationId: 'first-operation', inputHash: expect.any(String) });
    expect(generate).not.toHaveBeenCalled();
    const duplicate = start('first-operation');
    expect(duplicate.job.id).toBe(accepted.job.id);
    expect(duplicate.completion).toBe(accepted.completion);
    await accepted.completion;
    expect(generate.mock.calls[0][0].maxRetries).toBe(0);
    const completed = canvas.jobs.get(accepted.job.id);
    expect(completed).toMatchObject({ status: 'succeeded', endedAt: expect.any(String), result: canvas.getNode(canvasId, node.id)?.output });
    expect(canvas.getNode(canvasId, node.id)?.runState).toBe('done');
    expect(JSON.stringify(completed)).not.toContain('never-persist-this-key');
    canvas.updateNode(canvasId, node.id, { params: { prompt: 'edited after completion', size: '1024x1024' } });
    expect(start('first-operation').job.id).toBe(accepted.job.id);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('prepare failure is terminal without provider submission and a manual retry receives a fresh generation', async () => {
    const { canvas, canvasId, node, start } = await fixture('');
    const failed = start();
    await failed.completion;
    expect(canvas.jobs.get(failed.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/提示词/) });
    expect(canvas.jobs.get(failed.job.id)?.submittedAt).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
    canvas.updateNode(canvasId, node.id, { params: { prompt: 'retry', size: '1024x1024' } });
    generate.mockResolvedValue(result);
    const retried = start();
    await retried.completion;
    expect(retried.job.id).not.toBe(failed.job.id);
    expect(canvas.jobs.get(retried.job.id)).toMatchObject({ generation: 2, status: 'succeeded' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('provider failure keeps previous assets and commits the failed ledger with the error projection', async () => {
    const { canvas, canvasId, node, start } = await fixture();
    canvas.updateNode(canvasId, node.id, { runState: 'done', output: { assets: [`${canvasId}/previous.png`] } });
    generate.mockRejectedValue(new Error('HTTP 429 rate limited'));
    const accepted = start();
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/限流/), submittedAt: expect.any(String) });
    expect(canvas.getNode(canvasId, node.id)).toMatchObject({ runState: 'error', output: { assets: [`${canvasId}/previous.png`], error: expect.stringMatching(/限流/) } });
  });

  it('cancels an ignored provider, terminalizes both sides and rejects late results', async () => {
    const { canvas, canvasId, dataRoot, node, start } = await fixture();
    const pending = deferred<typeof result>();
    generate.mockReturnValue(pending.promise);
    const abort = new AbortController();
    const accepted = start('cancel-operation', abort.signal);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    abort.abort();
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)).toMatchObject({ status: 'cancelled', cancelReason: 'user_cancelled' });
    expect(canvas.getNode(canvasId, node.id)?.runState).toBe('idle');
    pending.resolve(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canvas.getNode(canvasId, node.id)?.output?.assets).toBeUndefined();
    expect(await readdir(canvasAssetsDir(dataRoot, canvasId)).catch((): string[] => [])).toEqual([]);
  });

  it('replaying an older operation neither supersedes nor aborts the latest running generation', async () => {
    const { canvas, canvasId, node, start } = await fixture();
    const older = deferred<typeof result>();
    const newer = deferred<typeof result>();
    generate.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = start('older-operation');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    canvas.updateNode(canvasId, node.id, { params: { prompt: 'newer', size: '1024x1024' } });
    const second = start('newer-operation');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    const replay = start('older-operation');
    expect(replay.job.id).toBe(first.job.id);
    expect(canvas.jobs.get(first.job.id)).toMatchObject({ status: 'cancelled', cancelReason: 'superseded' });
    expect(canvas.jobs.get(second.job.id)?.status).toBe('running');
    expect(generate.mock.calls[1][0].abortSignal.aborted).toBe(false);
    newer.resolve(result);
    await second.completion;
    await first.completion;
    older.resolve(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canvas.jobs.get(second.job.id)?.status).toBe('succeeded');
    expect(canvas.getNode(canvasId, node.id)?.output?.resultSet?.[0]?.prompt).toBe('newer');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('shutdown interrupts synchronously, releases an ignored provider and prevents DB access after close', async () => {
    const { canvas, canvasId, node, start, closeDb } = await fixture();
    canvas.updateNode(canvasId, node.id, { output: { assets: [`${canvasId}/previous.png`] } });
    const pending = deferred<typeof result>();
    generate.mockReturnValue(pending.promise);
    const accepted = start();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    nodeJobsFor(canvas).shutdown();
    expect(canvas.jobs.get(accepted.job.id)).toMatchObject({ status: 'interrupted', cancelReason: 'host_shutdown' });
    expect(canvas.getNode(canvasId, node.id)).toMatchObject({ runState: 'error', output: { assets: [`${canvasId}/previous.png`], error: expect.stringMatching(/中断.*重试/) } });
    await accepted.completion;
    closeDb();
    const read = vi.spyOn(canvas, 'getNode');
    pending.resolve(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(read).not.toHaveBeenCalled();
    expect(() => start()).toThrowError(expect.objectContaining({ status: 503 }));
  });

  it('shutdown before dispatch leaves a durable interrupted record and never bills the provider', async () => {
    const { canvas, node, canvasId, start } = await fixture();
    const accepted = start();
    nodeJobsFor(canvas).shutdown();
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)).toMatchObject({ status: 'interrupted' });
    expect(canvas.jobs.get(accepted.job.id)?.submittedAt).toBeUndefined();
    expect(canvas.getNode(canvasId, node.id)?.runState).toBe('error');
    expect(generate).not.toHaveBeenCalled();
  });

  it('direct deletion before dispatch releases admission and leaves a cancelled record', async () => {
    const { canvas, canvasId, node, start } = await fixture();
    const accepted = start();
    canvas.deleteNode(canvasId, node.id);
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)?.status).toBe('cancelled');
    expect(generate).not.toHaveBeenCalled();
  });

  it('a failed document projection rolls back successful ledger outcome and removes generated files', async () => {
    const { canvas, canvasId, dataRoot, node, start } = await fixture();
    const update = canvas.updateNode.bind(canvas);
    vi.spyOn(canvas, 'updateNode').mockImplementation((id, nodeId, patch) => {
      const written = update(id, nodeId, patch);
      if (patch.runState === 'done') throw new Error('document projection failed after write');
      return written;
    });
    generate.mockResolvedValue(result);
    const accepted = start();
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)).toMatchObject({ status: 'failed' });
    expect(canvas.jobs.get(accepted.job.id)?.result).toBeUndefined();
    expect(canvas.getNode(canvasId, node.id)?.runState).toBe('error');
    expect(canvas.getNode(canvasId, node.id)?.output?.assets).toBeUndefined();
    expect(await readdir(canvasAssetsDir(dataRoot, canvasId))).toEqual([]);
  });

  it('a ledger failure after its success write rolls back the node output in the same transaction', async () => {
    const { canvas, canvasId, dataRoot, node, start } = await fixture();
    const finish = canvas.jobs.finish.bind(canvas.jobs);
    vi.spyOn(canvas.jobs, 'finish').mockImplementation((id, status, details) => {
      const terminal = finish(id, status, details);
      if (status === 'succeeded') throw new Error('ledger failure after write');
      return terminal;
    });
    generate.mockResolvedValue(result);
    const accepted = start();
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)?.status).toBe('failed');
    expect(canvas.jobs.get(accepted.job.id)?.result).toBeUndefined();
    expect(canvas.getNode(canvasId, node.id)?.runState).toBe('error');
    expect(canvas.getNode(canvasId, node.id)?.output?.assets).toBeUndefined();
    expect(await readdir(canvasAssetsDir(dataRoot, canvasId))).toEqual([]);
  });

  it('freezes fixed anchors and selected mention versions while provider settings preparation is delayed', async () => {
    const { canvas, canvasId, dataRoot, node, options } = await fixture();
    const ref = canvas.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, title: 'Original reference', params: {} }).node;
    const dir = canvasAssetsDir(dataRoot, canvasId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'old.png'), PNG);
    const changedBytes = Buffer.from('new-reference');
    await writeFile(path.join(dir, 'new.png'), changedBytes);
    canvas.updateNode(canvasId, ref.id, { output: { assets: [`${canvasId}/old.png`, `${canvasId}/new.png`], activeAssetIndex: 1 } });
    canvas.assets.register({ id: 'fixed-old', canvasId, nodeId: ref.id, path: `${canvasId}/old.png`, kind: 'image',
      mimeType: 'image/png', byteSize: PNG.length, contentHash: createHash('sha256').update(PNG).digest('hex'), source: 'imported' });
    const anchor = canvas.addNode(canvasId, { type: 'anchor', x: 0, y: 0, w: 100, h: 100,
      params: { assetId: 'fixed-old', role: 'content', strength: 'high', note: '保持构图' } }).node;
    canvas.updateNode(canvasId, anchor.id, { output: { assets: [`${canvasId}/new.png`] } });
    canvas.addEdge(canvasId, { sourceId: anchor.id, targetId: node.id, targetHandle: 'ref_1' });
    canvas.updateNode(canvasId, node.id, { params: { prompt: `Use ${serializeMention('Original reference', ref.id)}`, size: '1024x1024' } });
    const preparing = deferred<typeof settings>();
    const get = vi.fn(() => preparing.promise);
    const accepted = startImageNode({ ...options, operationId: 'frozen-references', settingsStore: { get } as unknown as SettingsStore });
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    canvas.deleteNode(canvasId, ref.id);
    canvas.updateNode(canvasId, anchor.id, { output: { assets: [`${canvasId}/new.png`], activeAssetIndex: 3 }, runState: 'error' });
    const registryRead = vi.spyOn(canvas.assets, 'get').mockImplementation(() => { throw new Error('Must use captured reference paths'); });
    expect(startImageNode({ ...options, operationId: 'frozen-references' }).job.id).toBe(accepted.job.id);
    generate.mockResolvedValue(result);
    preparing.resolve(settings);
    await accepted.completion;
    expect(Buffer.from(generate.mock.calls[0][0].prompt.images[0])).toEqual(PNG);
    expect(Buffer.from(generate.mock.calls[0][0].prompt.images[1])).toEqual(changedBytes);
    expect(generate.mock.calls[0][0].prompt.text).toContain('严格保持完全一致 <<<image 1>>>');
    expect(generate.mock.calls[0][0].prompt.text).toContain('<<<image 2>>>');
    expect(registryRead).not.toHaveBeenCalled();
    expect(canvas.getSnapshot(canvasId)?.nodes.find((item) => item.id === node.id)?.dirty).toBe(false);
    const storedRefs = canvas.jobs.get(accepted.job.id)?.input.nodes as Array<{ id: string; output?: { assets?: string[] } }>;
    expect(storedRefs.find((item) => item.id === ref.id)?.output?.assets).toEqual([`${canvasId}/old.png`, `${canvasId}/new.png`]);
    expect(storedRefs.find((item) => item.id === anchor.id)?.output?.assets).toEqual([`${canvasId}/old.png`]);
  });

  it('rejects invalid fixed references and fails unreadable pinned files before provider submission', async () => {
    const { canvas, canvasId, dataRoot, node, start } = await fixture();
    const anchor = canvas.addNode(canvasId, { type: 'anchor', x: 0, y: 0, w: 100, h: 100,
      params: { assetId: 'missing', role: 'style', strength: 'mid' } }).node;
    canvas.addEdge(canvasId, { sourceId: anchor.id, targetId: node.id, targetHandle: 'ref_1' });
    const register = (id: string, kind: 'image' | 'audio') => canvas.assets.register({ id, canvasId,
      path: `${canvasId}/${id}.png`, kind, mimeType: kind === 'image' ? 'image/png' : 'audio/wav', byteSize: PNG.length,
      contentHash: createHash('sha256').update(PNG).digest('hex'), source: 'imported' });
    register('wrong-kind', 'audio');
    for (const assetId of ['missing', '', 'wrong-kind']) {
      canvas.updateNode(canvasId, anchor.id, { params: { assetId, role: 'style', strength: 'mid' } });
      expect(() => start()).toThrow();
    }
    expect(canvas.jobs.list(canvasId)).toHaveLength(0);
    const absent = register('absent-file', 'image');
    await mkdir(canvasAssetsDir(dataRoot, canvasId), { recursive: true });
    canvas.updateNode(canvasId, anchor.id, { params: { assetId: absent.id, role: 'style', strength: 'mid' } });
    const failed = start('unreadable-fixed');
    await failed.completion;
    expect(canvas.jobs.get(failed.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/固定参考图无法读取/) });
    expect(canvas.jobs.get(failed.job.id)?.submittedAt).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
    canvas.updateNode(canvasId, anchor.id, { params: { assetId: 'missing', role: 'style', strength: 'mid' } });
    expect(start('unreadable-fixed').job.id).toBe(failed.job.id);
    canvas.updateNode(canvasId, anchor.id, { params: { role: 'style', strength: 'mid' }, output: { assets: [absent.path] } });
    generate.mockResolvedValue(result);
    const legacy = start();
    await legacy.completion;
    expect(canvas.jobs.get(legacy.job.id)?.status).toBe('succeeded');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('records the effective fallback provider rather than the missing requested provider', async () => {
    const { canvas, options } = await fixture();
    const fallback = { get: async () => ({ activeProviderId: 'openai', providers: { reizo: { apiKey: 'fallback-secret', baseUrl: 'https://example.test/v1' } } }) } as unknown as SettingsStore;
    generate.mockResolvedValue(result);
    const accepted = startImageNode({ ...options, providerId: 'openai', settingsStore: fallback });
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)).toMatchObject({ providerId: 'reizo', model: 'gpt-image-2', status: 'succeeded' });
    expect(JSON.stringify(canvas.jobs.get(accepted.job.id))).not.toContain('fallback-secret');
  });

  it('does not report success for invalid counts or an empty provider result', async () => {
    const { canvas, canvasId, node, start } = await fixture();
    canvas.updateNode(canvasId, node.id, { params: { prompt: 'image', size: '1024x1024', count: 'invalid' } });
    const invalid = start();
    await invalid.completion;
    expect(canvas.jobs.get(invalid.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/数量/) });
    expect(canvas.jobs.get(invalid.job.id)?.submittedAt).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
    canvas.updateNode(canvasId, node.id, { params: { prompt: 'image', size: '1024x1024', count: 1 } });
    generate.mockResolvedValue({ images: [] });
    const empty = start();
    await empty.completion;
    expect(canvas.jobs.get(empty.job.id)?.status).toBe('failed');
    expect(canvas.getNode(canvasId, node.id)?.output?.assets).toBeUndefined();
  });

  it('pre-aborted admission is durably cancelled without submission', async () => {
    const { canvas, start } = await fixture();
    const abort = new AbortController();
    abort.abort();
    const accepted = start('pre-aborted', abort.signal);
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)?.status).toBe('cancelled');
    expect(canvas.jobs.get(accepted.job.id)?.submittedAt).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });

  it('zero-byte image output fails the ledger and node without retaining an empty file', async () => {
    const { canvas, canvasId, dataRoot, node, start } = await fixture();
    generate.mockResolvedValue({ images: [{ uint8Array: new Uint8Array(0), mediaType: 'image/png' }] });
    const accepted = start();
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)?.status).toBe('failed');
    expect(canvas.jobs.get(accepted.job.id)?.result).toBeUndefined();
    expect(canvas.getNode(canvasId, node.id)?.runState).toBe('error');
    expect(canvas.getNode(canvasId, node.id)?.output?.assets).toBeUndefined();
    expect(await readdir(canvasAssetsDir(dataRoot, canvasId)).catch((): string[] => [])).toEqual([]);
  });

  it('a cancelled variation batch cannot start additional paid calls', async () => {
    const { canvas, canvasId, node, start } = await fixture();
    canvas.updateNode(canvasId, node.id, { params: { prompt: 'image', size: '1024x1024', count: 4 } });
    const abort = new AbortController();
    const pending = deferred<typeof result>();
    generate.mockImplementation(() => { abort.abort(); return pending.promise; });
    const accepted = start(undefined, abort.signal);
    await accepted.completion;
    expect(canvas.jobs.get(accepted.job.id)?.status).toBe('cancelled');
    expect(generate).toHaveBeenCalledTimes(1);
    pending.resolve(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
