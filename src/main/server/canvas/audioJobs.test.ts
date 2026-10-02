import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { ProviderStore } from '../storage/providerStore';
import type { ManagedProviderConfig } from '../../../shared/providerRegistry';
import type { AudioJobResult } from './audioDrivers';
import { serializeMention } from '../../../shared/resolveMentions';
import { generationSchedulerFor } from './generationScheduler';
import { stopCanvasWork } from './workLifecycle';
import { getCanvasChannel } from './channel';

const hooks = vi.hoisted(() => ({ synthesize: vi.fn(), mkdir: vi.fn(), write: vi.fn(), remove: vi.fn() }));
vi.mock('./audioDrivers', async (original) => {
  const actual = await original<typeof import('./audioDrivers')>();
  return { ...actual, getAudioDriver: (id: string) => ({ ...actual.getAudioDriver(id), synthesize: hooks.synthesize }) };
});
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>(), mkdir: hooks.mkdir, writeFile: hooks.write, rm: hooks.remove }));
import { replayAudioJob, runAudioNode, startAudioNode } from './audioExecutor';

const output: AudioJobResult = { audioBuffer: Buffer.from('generated-audio-payload'), format: 'mp3' };
const cleanups: Array<() => Promise<void>> = [];
let fs: typeof import('node:fs/promises');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  hooks.synthesize.mockReset().mockResolvedValue(output);
  hooks.mkdir.mockReset().mockImplementation(fs.mkdir);
  hooks.write.mockReset().mockImplementation(fs.writeFile);
  hooks.remove.mockReset().mockImplementation(fs.rm);
});
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const handle = openDb(':memory:');
  const store = createCanvasStore(handle);
  const session = await createSqliteSessionStore(handle).create('audio jobs', null, null);
  const canvasId = store.ensureCanvas(session.id).id;
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-audio-jobs-'));
  const provider: ManagedProviderConfig = {
    id: 'audio-provider', name: 'Configured audio', category: 'audio', driverType: 'mock', enabled: true, isDefault: true,
    credentials: { apiKey: 'provider-secret-token', baseUrl: 'https://example.test/v1' },
    sampleParams: { model: 'ignored-mock-selector', format: 'wav', voice: 'configured-voice' }, createdAt: '', updatedAt: '',
  };
  const get = vi.fn(async (id: string) => id === provider.id ? provider : null);
  const catalog = vi.fn(async () => ({ defaultProviderByCategory: { audio: provider.id }, providers: [{ id: provider.id, category: 'audio', enabled: true }] }));
  const providerStore = { getByIdWithSecret: get, getPublicCatalog: catalog } as unknown as ProviderStore;
  const node = store.addNode(canvasId, { type: 'audio', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'original request' } }).node;
  let closed = false;
  const close = () => { handle.close(); closed = true; };
  cleanups.push(async () => {
    if (!closed) { stopCanvasWork(store); close(); }
    if (!path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Temporary test directory escaped its root');
    await fs.rm(dataRoot, { recursive: true, force: true });
  });
  const options = { canvasStore: store, providerStore, canvasId, node, dataRoot };
  const start = (operationId?: string, signal?: AbortSignal, providerId: string | undefined = provider.id) => startAudioNode({ ...options, operationId, signal, providerId });
  const dir = path.join(dataRoot, 'canvas', canvasId);
  const files = () => readdir(dir).catch((): string[] => []);
  const noLateReads = () => {
    const methods = [vi.spyOn(store, 'getNode'), vi.spyOn(store, 'getSnapshot'), vi.spyOn(store, 'upstreamNodes'), vi.spyOn(store, 'updateNode'), vi.spyOn(store.jobs, 'get')];
    return () => methods.forEach((method) => expect(method).not.toHaveBeenCalled());
  };
  return { store, canvasId, node, dataRoot, dir, provider, providerStore, get, catalog, options, start, close, files, noLateReads };
}

describe('durable audio generation', () => {
  it('admits synchronously, marks the effective provider/model before synthesis and replays the same job without credentials or bytes in its ledger', async () => {
    const f = await fixture();
    f.store.updateNode(f.canvasId, f.node.id, { params: { prompt: 'original request', model: 'requested-model' } });
    hooks.synthesize.mockImplementation((params, credentials, options) => {
      expect(f.store.jobs.current(f.canvasId, f.node.id)).toMatchObject({ status: 'running', providerId: f.provider.id, model: 'mock-synth-1', submittedAt: expect.any(String) });
      expect(params.model).toBe('mock-synth-1');
      expect(credentials.apiKey).toBe('provider-secret-token');
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(output);
    });
    const admitted = f.start('same-operation');
    expect(f.store.jobs.get(admitted.job.id)).toMatchObject({ nodeType: 'audio', status: 'queued', generation: 1, inputHash: expect.any(String) });
    expect(hooks.synthesize).not.toHaveBeenCalled();
    const replay = f.start('same-operation');
    expect(replay.job.id).toBe(admitted.job.id);
    expect(replay.completion).toBe(admitted.completion);
    await admitted.completion;
    const job = f.store.jobs.get(admitted.job.id);
    const node = f.store.getNode(f.canvasId, f.node.id);
    expect(job).toMatchObject({ status: 'succeeded', result: node.output, model: 'mock-synth-1' });
    expect(node.output.resultSet[0]).toMatchObject({ model: 'mock-synth-1', prompt: 'original request' });
    expect(await readFile(path.join(f.dataRoot, 'canvas', node.output.assets[0]))).toEqual(output.audioBuffer);
    expect(JSON.stringify(job)).not.toContain('provider-secret-token');
    expect(JSON.stringify(job)).not.toContain('generated-audio-payload');
    expect(JSON.stringify(job)).not.toContain('audioBuffer');
    f.store.updateNode(f.canvasId, f.node.id, { params: { prompt: 'changed after success' } });
    expect(f.start('same-operation').job.id).toBe(admitted.job.id);
    expect(hooks.synthesize).toHaveBeenCalledTimes(1);
  });

  it('freezes inherited and mentioned text, node parameters and input hash before provider preparation', async () => {
    const f = await fixture();
    const agent = f.store.addNode(f.canvasId, { type: 'agent', x: 0, y: 0, w: 100, h: 100, title: 'Speaker', params: {} }).node;
    f.store.updateNode(f.canvasId, agent.id, { output: { text: 'original speech' } });
    const note = f.store.addNode(f.canvasId, { type: 'note', x: 0, y: 0, w: 100, h: 100, params: { content: `Say ${serializeMention('Speaker', agent.id)}` } }).node;
    expect(f.store.addEdge(f.canvasId, { sourceId: note.id, targetId: f.node.id }).edge).toBeDefined();
    f.store.updateNode(f.canvasId, f.node.id, { params: { prompt: '', voiceId: 'original-voice' } });
    const preparing = deferred<ManagedProviderConfig>();
    f.get.mockReturnValueOnce(preparing.promise);
    const admitted = f.start();
    await vi.waitFor(() => expect(f.get).toHaveBeenCalledTimes(1));
    f.store.updateNode(f.canvasId, note.id, { params: { content: 'changed source' } });
    f.store.updateNode(f.canvasId, agent.id, { output: { text: 'changed mention' } });
    f.store.updateNode(f.canvasId, f.node.id, { params: { prompt: 'changed request', voiceId: 'changed-voice' } });
    preparing.resolve(f.provider);
    await admitted.completion;
    expect(hooks.synthesize.mock.calls[0][0]).toMatchObject({ prompt: 'Say original speech', voiceId: 'original-voice' });
    const current = f.store.getSnapshot(f.canvasId).nodes.find((node) => node.id === f.node.id);
    expect(current.params).toMatchObject({ prompt: 'changed request', voiceId: 'changed-voice' });
    expect(current.paramsHash).toBe(f.store.jobs.get(admitted.job.id)?.inputHash);
    expect(current.output.resultSet[0].prompt).toBe('Say original speech');
    expect(current.dirty).toBe(true);
  });

  it.each(['missing', 'disabled', 'wrong-category', 'unknown-driver', 'missing-key'] as const)('rejects %s provider preparation without paid submission or fallback', async (kind) => {
    const f = await fixture();
    if (kind === 'missing') f.get.mockResolvedValueOnce(null);
    if (kind === 'disabled') f.provider.enabled = false;
    if (kind === 'wrong-category') f.provider.category = 'image';
    if (kind === 'unknown-driver') f.provider.driverType = 'not-a-real-driver';
    if (kind === 'missing-key') { f.provider.driverType = 'minimax'; f.provider.credentials.apiKey = ''; }
    const admitted = f.start();
    await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)?.status).toBe('failed');
    expect(f.store.jobs.get(admitted.job.id)?.submittedAt).toBeUndefined();
    expect(f.store.getNode(f.canvasId, f.node.id)?.runState).toBe('error');
    expect(hooks.synthesize).not.toHaveBeenCalled();
    expect(f.catalog).not.toHaveBeenCalled();
  });

  it('uses catalog defaults only for an unspecified provider, respects configured format and leaves omitted pitch to the driver', async () => {
    const f = await fixture();
    f.provider.driverType = 'minimax';
    f.provider.sampleParams = { model: 'speech-01-turbo', format: 'wav', voice_id: 'configured-voice', speed: 1.2 };
    hooks.synthesize.mockResolvedValue({ ...output, format: 'wav' });
    const admitted = startAudioNode({ ...f.options, operationId: 'catalog-default' });
    await admitted.completion;
    expect(f.catalog).toHaveBeenCalledTimes(1);
    expect(hooks.synthesize.mock.calls[0][0]).toMatchObject({ model: 'speech-01-turbo', format: 'wav', voiceId: 'configured-voice', speed: 1.2 });
    expect(hooks.synthesize.mock.calls[0][0].pitch).toBeUndefined();
    expect(f.store.jobs.get(admitted.job.id)).toMatchObject({ status: 'succeeded', providerId: f.provider.id, model: 'speech-01-turbo' });
    expect((await f.files())[0]).toMatch(/\.wav$/);
  });

  it('invalid configured format is a prepare failure and never invokes the driver', async () => {
    const f = await fixture(); f.provider.sampleParams.format = 'ogg';
    const admitted = f.start(); await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/格式/) });
    expect(f.store.jobs.get(admitted.job.id)?.submittedAt).toBeUndefined();
    expect(hooks.synthesize).not.toHaveBeenCalled();
  });

  const invalid: Array<{ name: string; result: unknown }> = [
    { name: 'missing result', result: undefined }, { name: 'missing buffer', result: { format: 'mp3' } },
    { name: 'empty buffer', result: { audioBuffer: Buffer.alloc(0), format: 'mp3' } },
    { name: 'unsupported format', result: { audioBuffer: Buffer.from('audio'), format: 'ogg' } },
  ];
  it.each(invalid)('$name fails both the ledger and node without publishing a file', async ({ result }) => {
    const f = await fixture(); hooks.synthesize.mockResolvedValueOnce(result as AudioJobResult);
    const admitted = f.start(); await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)?.status).toBe('failed');
    expect(f.store.jobs.get(admitted.job.id)?.result).toBeUndefined();
    expect(f.store.getNode(f.canvasId, f.node.id)?.runState).toBe('error');
    expect(f.store.getNode(f.canvasId, f.node.id)?.output?.assets).toBeUndefined();
    expect(hooks.write).not.toHaveBeenCalled(); expect(await f.files()).toEqual([]);
  });

  it('preserves previous assets and versions through failure and retry, clearing old errors and progress on success', async () => {
    const f = await fixture();
    const previous = `${f.canvasId}/previous.wav`;
    f.store.updateNode(f.canvasId, f.node.id, { output: { assets: [previous], resultSet: [{ asset: previous, model: 'old-model' }], error: 'old error', progress: 35 } });
    hooks.synthesize.mockRejectedValueOnce(new Error('HTTP 429 rate limited'));
    const failed = f.start('failed-op'); await failed.completion;
    expect(f.store.jobs.get(failed.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/限流/) });
    expect(f.store.getNode(f.canvasId, f.node.id)?.output?.assets).toEqual([previous]);
    expect(f.start('failed-op').job.id).toBe(failed.job.id);
    const retried = f.start(); await retried.completion;
    expect(retried.job.id).not.toBe(failed.job.id);
    expect(retried.job.generation).toBe(2);
    const output = f.store.getNode(f.canvasId, f.node.id).output;
    expect(output.assets).toHaveLength(2); expect(output.assets[1]).toBe(previous);
    expect(output.resultSet[1]).toEqual({ asset: previous, model: 'old-model' });
    expect(output.error).toBeUndefined(); expect(output.progress).toBeUndefined();
  });

  it('old operation replay does not supersede a newer generation, and a late old result cannot overwrite it', async () => {
    const f = await fixture();
    const old = deferred<AudioJobResult>(); const latest = deferred<AudioJobResult>();
    hooks.synthesize.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const first = f.start('old-op'); await vi.waitFor(() => expect(hooks.synthesize).toHaveBeenCalledTimes(1));
    f.store.updateNode(f.canvasId, f.node.id, { params: { prompt: 'new request' } });
    const second = f.start('new-op'); await vi.waitFor(() => expect(hooks.synthesize).toHaveBeenCalledTimes(2));
    expect(replayAudioJob(f.store, f.canvasId, f.node.id, 'old-op', f.provider.id)?.job.id).toBe(first.job.id);
    expect(f.store.jobs.get(first.job.id)).toMatchObject({ status: 'cancelled', cancelReason: 'superseded' });
    expect(hooks.synthesize.mock.calls[1][2].signal.aborted).toBe(false);
    latest.resolve({ ...output, audioBuffer: Buffer.from('new audio') });
    await second.completion; await first.completion;
    old.resolve({ ...output, audioBuffer: Buffer.from('old audio') });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const current = f.store.getNode(f.canvasId, f.node.id).output;
    expect(current.resultSet[0].prompt).toBe('new request');
    expect(await readFile(path.join(f.dataRoot, 'canvas', current.assets[0]))).toEqual(Buffer.from('new audio'));
    expect(await f.files()).toHaveLength(1);
  });

  it('audio waits behind a shared media permit and queued cancellation never marks submitted or calls the driver', async () => {
    const f = await fixture();
    const held = await generationSchedulerFor(f.store, { globalLimit: 1, providerLimit: 1 }).acquire(f.provider.id);
    const abort = new AbortController(); const admitted = f.start('queued-op', abort.signal);
    await vi.waitFor(() => expect(f.get).toHaveBeenCalledTimes(1));
    expect(hooks.synthesize).not.toHaveBeenCalled();
    expect(f.store.jobs.get(admitted.job.id)?.submittedAt).toBeUndefined();
    abort.abort(); await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)?.status).toBe('cancelled');
    held();
    const next = f.start('next-op'); await next.completion;
    expect(hooks.synthesize).toHaveBeenCalledTimes(1);
    expect(f.store.jobs.get(next.job.id)?.status).toBe('succeeded');
  });

  it('user abort releases an ignoring driver and permits another generation while keeping previous assets', async () => {
    const f = await fixture();
    generationSchedulerFor(f.store, { globalLimit: 1, providerLimit: 1 });
    f.store.updateNode(f.canvasId, f.node.id, { output: { assets: ['previous.wav'] } });
    const pending = deferred<AudioJobResult>(); hooks.synthesize.mockReturnValueOnce(pending.promise);
    const abort = new AbortController(); const admitted = f.start('cancelled-op', abort.signal);
    await vi.waitFor(() => expect(hooks.synthesize).toHaveBeenCalledTimes(1));
    abort.abort(); await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)).toMatchObject({ status: 'cancelled', cancelReason: 'user_cancelled' });
    expect(f.store.getNode(f.canvasId, f.node.id)).toMatchObject({ runState: 'idle', output: { assets: ['previous.wav'] } });
    const next = f.start(); await next.completion;
    pending.reject(new Error('late driver failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.store.jobs.get(next.job.id)?.status).toBe('succeeded');
    expect(hooks.synthesize).toHaveBeenCalledTimes(2);
    expect(await f.files()).toHaveLength(1);
  });

  it('a pre-aborted durable admission cancels while the legacy facade remains a no-op', async () => {
    const f = await fixture(); const abort = new AbortController(); abort.abort();
    const admitted = f.start('pre-aborted', abort.signal); await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)?.status).toBe('cancelled');
    const before = f.store.jobs.list().length;
    await runAudioNode({ ...f.options, signal: abort.signal });
    expect(f.store.jobs.list()).toHaveLength(before); expect(hooks.synthesize).not.toHaveBeenCalled();
  });

  it('stopping work before dispatch records interruption and blocks subsequent admission', async () => {
    const f = await fixture(); const admitted = f.start(); stopCanvasWork(f.store); await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)).toMatchObject({ status: 'interrupted', cancelReason: 'host_shutdown' });
    expect(f.store.jobs.get(admitted.job.id)?.submittedAt).toBeUndefined();
    expect(f.store.getNode(f.canvasId, f.node.id)).toMatchObject({ runState: 'error', output: { error: expect.stringMatching(/中断.*重试/) } });
    expect(() => f.start()).toThrowError(expect.objectContaining({ status: 503 }));
    expect(hooks.synthesize).not.toHaveBeenCalled();
  });

  it.each(['prepare', 'synthesize'] as const)('late %s completion never accesses a closed database', async (stage) => {
    const f = await fixture(); const reached = deferred<void>();
    const prepare = deferred<ManagedProviderConfig>(); const synthesize = deferred<AudioJobResult>();
    if (stage === 'prepare') f.get.mockImplementationOnce(() => { reached.resolve(); return prepare.promise; });
    else hooks.synthesize.mockImplementationOnce(() => { reached.resolve(); return synthesize.promise; });
    const admitted = f.start(); await reached.promise;
    stopCanvasWork(f.store);
    expect(f.store.jobs.get(admitted.job.id)?.status).toBe('interrupted');
    const noReads = f.noLateReads(); f.close();
    prepare.resolve(f.provider); synthesize.resolve(output);
    await admitted.completion; await new Promise<void>((resolve) => setImmediate(resolve));
    noReads();
    await runAudioNode(f.options); noReads();
  });

  it('a late partial write is removed after shutdown without publishing or reading closed SQLite', async () => {
    const f = await fixture(); const reached = deferred<void>(); const paused = deferred<void>();
    hooks.write.mockImplementationOnce(async (filename, data) => { await fs.writeFile(filename, data); reached.resolve(); await paused.promise; });
    const events: unknown[] = []; const unsubscribe = getCanvasChannel(f.canvasId).subscribe((event) => events.push(event));
    const admitted = f.start(); await reached.promise;
    expect(await f.files()).toHaveLength(1);
    stopCanvasWork(f.store);
    expect(f.store.jobs.get(admitted.job.id)?.status).toBe('interrupted');
    const count = events.length; const noReads = f.noLateReads(); f.close();
    paused.resolve(); await admitted.completion;
    await vi.waitFor(async () => expect(await f.files()).toEqual([]));
    noReads(); expect(events).toHaveLength(count); unsubscribe();
  });

  it('a write failure removes its partial file and keeps terminal node/ledger failure consistent', async () => {
    const f = await fixture();
    hooks.write.mockImplementationOnce(async (filename, data) => { await fs.writeFile(filename, data); throw new Error('disk write failed after partial output'); });
    const admitted = f.start(); await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)?.status).toBe('failed');
    expect(f.store.getNode(f.canvasId, f.node.id)?.runState).toBe('error');
    expect(await f.files()).toEqual([]);
  });

  it.each(['document', 'ledger'] as const)('%s failure after its SQL write rolls back both success projections and removes the unpublished file', async (stage) => {
    const f = await fixture();
    if (stage === 'document') {
      const update = f.store.updateNode.bind(f.store);
      vi.spyOn(f.store, 'updateNode').mockImplementation((id, nodeId, patch) => { const result = update(id, nodeId, patch); if (patch.runState === 'done') throw new Error('document commit failed'); return result; });
    } else {
      const finish = f.store.jobs.finish.bind(f.store.jobs);
      vi.spyOn(f.store.jobs, 'finish').mockImplementation((id, status, details) => { const result = finish(id, status, details); if (status === 'succeeded') throw new Error('ledger commit failed'); return result; });
    }
    const admitted = f.start(); await admitted.completion;
    expect(f.store.jobs.get(admitted.job.id)?.status).toBe('failed');
    expect(f.store.jobs.get(admitted.job.id)?.result).toBeUndefined();
    expect(f.store.getNode(f.canvasId, f.node.id)?.runState).toBe('error');
    expect(f.store.getNode(f.canvasId, f.node.id)?.output?.assets).toBeUndefined();
    expect(await f.files()).toEqual([]);
  });
});
