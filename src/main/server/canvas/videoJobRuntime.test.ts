import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DbHandle } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore, type CanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import type { VideoGenerateParams, VideoJobStatus, VideoSubmission } from './videoDrivers';
import { VideoPollError } from './videoDrivers/types';
import { klingRemoteContextValid } from './videoDrivers/remoteEndpoints';

const mocks = vi.hoisted(() => ({ submit: vi.fn(), poll: vi.fn() }));
vi.mock('./videoDrivers', async (original) => ({
  ...await original<typeof import('./videoDrivers')>(),
  getVideoDriver: (id: string) => ({
    id, supportsRecovery: id === 'kling', defaultModel: 'kling-v1',
    validateRemoteContext: klingRemoteContextValid, submit: mocks.submit, poll: mocks.poll,
  }),
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

import { startVideoNode } from './videoExecutor';
import { cancelVideoJob, getActiveJob, isRecoverableVideoJob, resumeVideoJobs, stopVideoJobsForStore } from './asyncJobManager';
import { stopCanvasWork } from './workLifecycle';
import * as imageExecutor from './imageExecutor';
import * as assetFiles from './assets';
import { serializeMention } from '../../../shared/resolveMentions';

const resources = new Map<DbHandle, CanvasStore>();
const dirs: string[] = [];
const remoteContext = { baseUrl: 'https://original.example', queryPath: '/v1/videos/text2video' };
const settings = {
  get: async () => ({ providers: { openai: { apiKey: 'fresh-key', baseUrl: 'https://edited.example' } } }),
} as unknown as SettingsStore;
function deferred<T>() {
  let resolve: (value: T) => void; let reject: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }
beforeEach(() => {
  mocks.submit.mockReset().mockResolvedValue({ taskId: 'task', context: remoteContext });
  mocks.poll.mockReset().mockResolvedValue({ status: 'processing', progress: 30 });
});
afterEach(() => {
  for (const [handle, store] of resources) { stopVideoJobsForStore(store); stopCanvasWork(store); handle.close(); }
  resources.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  for (const dir of dirs.splice(0)) if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir())) rmSync(dir, { recursive: true });
});

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-video-ledger-')); dirs.push(dir);
  const dbPath = path.join(dir, 'sessions.db');
  const handle = openDb(dbPath);
  const store = createCanvasStore(handle); resources.set(handle, store);
  const session = await createSqliteSessionStore(handle).create('video', null, null);
  const canvasId = store.ensureCanvas(session.id).id;
  const node = store.addNode(canvasId, { type: 'video', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'saved cup', provider: 'kling' } }).node;
  store.updateNode(canvasId, node.id, { output: { assets: ['old.mp4'], resultSet: [{ asset: 'old.mp4' }] } });
  const options = { canvasStore: store, settingsStore: settings, dataRoot: dir, canvasId, node, providerId: 'openai', operationId: 'operation' };
  return { dir, dbPath, handle, store, canvasId, node, options };
}

describe('durable video lifecycle', () => {
  it('admits synchronously, freezes inputs/hash, and commits terminal output with retained history', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const accepted = startVideoNode(f.options);
    expect(accepted.job.status).toBe('queued');
    expect(f.store.jobs.get(accepted.job.id)?.submittedAt).toBeUndefined();
    await accepted.submitted;
    expect(f.store.jobs.get(accepted.job.id)).toMatchObject({ status: 'running', providerId: 'openai', model: 'kling-v1', remoteTask: { taskId: 'task' } });
    f.store.updateNode(f.canvasId, f.node.id, { params: { prompt: 'edited bowl', provider: 'kling' } });
    mocks.poll.mockResolvedValueOnce({ status: 'succeed', videoBuffer: Buffer.from('video') });
    vi.advanceTimersByTime(2_500);
    await accepted.completion;
    const job = f.store.jobs.get(accepted.job.id);
    const node = f.store.getNode(f.canvasId, f.node.id);
    expect(job?.status).toBe('succeeded');
    expect(node?.paramsHash).toBe(accepted.job.inputHash);
    expect(node?.output?.assets?.[1]).toBe('old.mp4');
    expect(node?.output?.resultSet?.[0].prompt).toBe('saved cup');
    expect(node?.output).toEqual(job?.result);
    expect(existsSync(path.join(imageExecutor.canvasAssetsDir(f.dir, f.canvasId), path.basename(node.output.assets[0])))).toBe(true);
    expect(startVideoNode(f.options).job.id).toBe(accepted.job.id);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(1);
  });

  it('reopens a file database and resumes the original generation with GET-only driver polling and current credentials', async () => {
    const f = await fixture();
    const first = startVideoNode(f.options); await first.submitted;
    expect(isRecoverableVideoJob(f.store.jobs.get(first.job.id))).toBe(true);
    stopVideoJobsForStore(f.store); stopCanvasWork(f.store);
    await first.completion;
    expect(f.store.jobs.get(first.job.id)?.status).toBe('running');
    f.handle.close(); resources.delete(f.handle);
    const reopened = openDb(f.dbPath); const restored = createCanvasStore(reopened); resources.set(reopened, restored);
    mocks.submit.mockClear(); mocks.poll.mockResolvedValueOnce({ status: 'succeed', videoBuffer: Buffer.from('recovered-video') });
    const resumed = resumeVideoJobs({ canvasStore: restored, settingsStore: settings, dataRoot: f.dir });
    expect(resumed.map((entry) => entry.job.id)).toEqual([first.job.id]);
    await resumed[0].completion;
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.poll.mock.calls.at(-1)?.[1]).toMatchObject({ apiKey: 'fresh-key', context: remoteContext });
    expect(restored.jobs.get(first.job.id)).toMatchObject({ generation: 1, status: 'succeeded' });
    expect(restored.jobs.list(f.canvasId)).toHaveLength(1);
    expect(restored.getNode(f.canvasId, f.node.id)?.output?.assets?.[1]).toBe('old.mp4');
  });

  it('freezes selected frame versions, role-ordered anchors and numbered mention reference bytes', async () => {
    const f = await fixture();
    const addImage = (type: 'image' | 'anchor', title: string, role?: string) => {
      const node = f.store.addNode(f.canvasId, { type, title, x: 0, y: 0, w: 100, h: 100, params: role ? { role, strength: 'mid' } : {} }).node;
      f.store.updateNode(f.canvasId, node.id, { output: { assets: [`${title}-old.png`, `${title}-selected.png`], activeAssetIndex: 1 } });
      return node;
    };
    const frame = addImage('image', 'frame');
    const style = addImage('anchor', 'style', 'style');
    const character = addImage('anchor', 'character', 'character');
    const fixed = addImage('anchor', 'fixed', 'content');
    const pinnedPath = `${f.canvasId}/fixed.png`;
    f.store.assets.register({ id: 'fixed-video-reference', canvasId: f.canvasId, nodeId: frame.id, path: pinnedPath,
      kind: 'image', mimeType: 'image/png', byteSize: 5, contentHash: 'a'.repeat(64), source: 'imported' });
    f.store.updateNode(f.canvasId, fixed.id, { params: { assetId: 'fixed-video-reference', role: 'content', strength: 'high' } });
    const mentioned = addImage('image', 'mention');
    for (const anchor of [style, fixed, character]) f.store.addEdge(f.canvasId, { sourceId: anchor.id, targetId: f.node.id, targetHandle: 'reference' });
    f.store.addEdge(f.canvasId, { sourceId: frame.id, targetId: f.node.id, targetHandle: 'start_frame' });
    f.store.updateNode(f.canvasId, f.node.id, { params: { prompt: `move ${serializeMention('mention', mentioned.id)}`, provider: 'kling' } });
    vi.spyOn(assetFiles, 'readCanvasAsset').mockImplementation(async (_root, asset) => Buffer.from(asset));
    const preparing = deferred<Awaited<ReturnType<SettingsStore['get']>>>();
    const accepted = startVideoNode({ ...f.options, settingsStore: { get: () => preparing.promise } as unknown as SettingsStore });
    f.store.deleteNode(f.canvasId, frame.id);
    f.store.updateNode(f.canvasId, fixed.id, { params: { assetId: 'missing', role: 'style', strength: 'low' }, output: { assets: ['changed.png'] } });
    const registryRead = vi.spyOn(f.store.assets, 'get').mockImplementation(() => { throw new Error('Must use captured paths'); });
    expect(startVideoNode(f.options).job.id).toBe(accepted.job.id);
    preparing.resolve(await settings.get());
    await accepted.submitted;
    const params = mocks.submit.mock.calls[0][0] as VideoGenerateParams;
    expect(Buffer.from(params.startImageBytes).toString()).toBe('frame-selected.png');
    expect(params.referenceImages?.map((reference) => Buffer.from(reference.bytes).toString())).toEqual(['character-selected.png', 'style-selected.png', pinnedPath, 'mention-selected.png']);
    expect(params.prompt).toContain('<<<image 1>>>'); expect(params.prompt).toContain('<<<image 2>>>'); expect(params.prompt).toContain('<<<image 3>>>'); expect(params.prompt).toContain('<<<image 4>>>');
    expect(registryRead).not.toHaveBeenCalled();
    const input = JSON.stringify(f.store.jobs.get(accepted.job.id)?.input);
    expect(input).toContain('mention-selected.png'); expect(input).not.toContain('fresh-key'); expect(input).not.toContain('startImageBytes');
  });

  it('rejects invalid fixed identities and unreadable pinned files before the video POST', async () => {
    const f = await fixture();
    const anchor = f.store.addNode(f.canvasId, { type: 'anchor', x: 0, y: 0, w: 100, h: 100,
      params: { assetId: 'missing', role: 'content', strength: 'mid' } }).node;
    f.store.addEdge(f.canvasId, { sourceId: anchor.id, targetId: f.node.id, targetHandle: 'reference' });
    f.store.assets.register({ id: 'audio-reference', canvasId: f.canvasId, path: `${f.canvasId}/wrong.wav`,
      kind: 'audio', mimeType: 'audio/wav', byteSize: 5, contentHash: 'b'.repeat(64), source: 'imported' });
    for (const assetId of ['missing', '', 'audio-reference']) {
      f.store.updateNode(f.canvasId, anchor.id, { params: { assetId, role: 'content', strength: 'mid' } });
      expect(() => startVideoNode(f.options)).toThrow();
    }
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(0);
    f.store.assets.register({ id: 'missing-mask-file', canvasId: f.canvasId, path: `${f.canvasId}/mask.png`,
      kind: 'mask', mimeType: 'image/png', byteSize: 5, contentHash: 'c'.repeat(64), source: 'mask' });
    f.store.updateNode(f.canvasId, anchor.id, { params: { assetId: 'missing-mask-file', role: 'content', strength: 'mid' } });
    vi.spyOn(assetFiles, 'readCanvasAsset').mockRejectedValue(new Error('file missing'));
    const accepted = startVideoNode(f.options);
    await accepted.completion;
    expect(f.store.jobs.get(accepted.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/固定参考图无法读取/) });
    expect(f.store.jobs.get(accepted.job.id)?.submittedAt).toBeUndefined();
    expect(mocks.submit).not.toHaveBeenCalled();
    f.store.updateNode(f.canvasId, anchor.id, { params: { assetId: 'missing', role: 'content', strength: 'mid' } });
    expect(startVideoNode(f.options).job.id).toBe(accepted.job.id);
  });

  it.each(['delete', 'supersede'] as const)('settles a stale poll after direct %s without touching the successor or leaking its permit/timer', async (action) => {
    vi.useFakeTimers();
    const f = await fixture(); const paused = deferred<VideoJobStatus>(); const reached = deferred<void>();
    mocks.poll.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    const accepted = startVideoNode(f.options); await accepted.submitted;
    vi.advanceTimersByTime(2_500); await reached.promise;
    if (action === 'delete') f.store.deleteNode(f.canvasId, f.node.id);
    else f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: f.node.id, nodeType: 'video', input: {}, operationId: 'successor' });
    paused.resolve({ status: 'succeed', videoBuffer: Buffer.from('stale') });
    await accepted.completion;
    expect(f.store.jobs.get(accepted.job.id)?.status).toBe('cancelled');
    expect(getActiveJob(f.canvasId, f.node.id, f.store)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    if (action === 'supersede') expect(f.store.jobs.current(f.canvasId, f.node.id)).toMatchObject({ generation: 2, status: 'queued' });
  });

  it('interrupts an uncertain pending POST at shutdown and drops its late accepted response after DB close', async () => {
    const f = await fixture(); const paused = deferred<VideoSubmission>(); const reached = deferred<void>();
    mocks.submit.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    const accepted = startVideoNode(f.options); await reached.promise;
    stopVideoJobsForStore(f.store); stopCanvasWork(f.store); await accepted.completion;
    expect(f.store.jobs.get(accepted.job.id)?.status).toBe('interrupted');
    const get = vi.spyOn(f.store.jobs, 'get'); const write = vi.spyOn(f.store, 'updateNode');
    f.handle.close(); resources.delete(f.handle);
    paused.resolve({ taskId: 'late-task', context: remoteContext }); await flush();
    expect(get).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.poll).not.toHaveBeenCalled();
  });

  it('retries a completed task download network failure without losing the poll timer or POSTing again', async () => {
    vi.useFakeTimers(); const f = await fixture();
    mocks.poll.mockResolvedValue({ status: 'succeed', videoUrl: 'https://media.example/video.mp4' });
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('network offline')).mockResolvedValueOnce(new Response('video'));
    vi.stubGlobal('fetch', fetcher);
    const accepted = startVideoNode(f.options); await accepted.submitted;
    vi.advanceTimersByTime(2_500); await flush();
    expect(f.store.jobs.get(accepted.job.id)?.status).toBe('running'); expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2_500); await accepted.completion;
    expect(f.store.jobs.get(accepted.job.id)?.status).toBe('succeeded'); expect(mocks.submit).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('distinguishes provider task failure from exhausted retryable query errors', async () => {
    vi.useFakeTimers(); const f = await fixture();
    mocks.poll.mockRejectedValue(new VideoPollError('provider temporarily unavailable', true));
    const accepted = startVideoNode(f.options); await accepted.submitted;
    for (let i = 0; i < 5; i += 1) { vi.advanceTimersByTime(2_500); await flush(); }
    await accepted.completion;
    expect(f.store.jobs.get(accepted.job.id)).toMatchObject({ status: 'interrupted', remoteTask: { taskId: 'task' } });
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.poll).toHaveBeenCalledTimes(5);
    mocks.poll.mockResolvedValueOnce({ status: 'failed', error: 'provider rejected content' });
    const next = startVideoNode({ ...f.options, operationId: 'new-operation' }); await next.submitted;
    vi.advanceTimersByTime(2_500); await next.completion;
    expect(f.store.jobs.get(next.job.id)).toMatchObject({ status: 'failed', error: 'provider rejected content' });
    expect(f.store.getNode(f.canvasId, f.node.id)?.output?.assets).toEqual(['old.mp4']);
  });

  it('removes a partial/unpublished file after terminal projection rolls back', async () => {
    vi.useFakeTimers(); const f = await fixture();
    mocks.poll.mockResolvedValueOnce({ status: 'succeed', videoBuffer: Buffer.from('video') });
    const finish = f.store.jobs.finish.bind(f.store.jobs);
    vi.spyOn(f.store.jobs, 'finish').mockImplementation((id, status, details) => {
      if (status === 'succeeded') throw new Error('terminal transaction failed');
      return finish(id, status, details);
    });
    const accepted = startVideoNode(f.options); await accepted.submitted;
    vi.advanceTimersByTime(2_500); await accepted.completion;
    expect(f.store.jobs.get(accepted.job.id)?.status).toBe('interrupted');
    expect(f.store.getNode(f.canvasId, f.node.id)?.output?.assets).toEqual(['old.mp4']);
    const assets = imageExecutor.canvasAssetsDir(f.dir, f.canvasId);
    await vi.waitFor(() => expect(readdirSync(assets)).toEqual([]));
  });

  it('cancelled terminal history remains immutable when a remote poll finishes late', async () => {
    vi.useFakeTimers(); const f = await fixture(); const paused = deferred<VideoJobStatus>(); const reached = deferred<void>();
    mocks.poll.mockImplementationOnce(() => { reached.resolve(); return paused.promise; });
    const accepted = startVideoNode(f.options); await accepted.submitted; vi.advanceTimersByTime(2_500); await reached.promise;
    cancelVideoJob(f.canvasId, f.node.id, f.store); const saved = f.store.jobs.get(accepted.job.id);
    paused.resolve({ status: 'succeed', videoBuffer: Buffer.from('late') }); await flush();
    expect(f.store.jobs.get(accepted.job.id)).toEqual(saved); expect(saved?.status).toBe('cancelled');
    expect(f.store.getNode(f.canvasId, f.node.id)).toMatchObject({ runState: 'idle', output: { assets: ['old.mp4'] } });
  });

  it('cleans a late written file after graceful detach and SQLite close without reading the closed ledger', async () => {
    vi.useFakeTimers(); const f = await fixture();
    mocks.poll.mockResolvedValueOnce({ status: 'succeed', videoBuffer: Buffer.from('video') });
    const write = vi.mocked(fs.writeFile).getMockImplementation();
    if (!write) throw new Error('Expected the original filesystem implementation');
    const reached = deferred<void>(); const paused = deferred<void>();
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => { await write(...args); reached.resolve(); await paused.promise; });
    const accepted = startVideoNode(f.options); await accepted.submitted; vi.advanceTimersByTime(2_500); await reached.promise;
    stopVideoJobsForStore(f.store); stopCanvasWork(f.store);
    expect(f.store.jobs.get(accepted.job.id)?.status).toBe('running');
    const get = vi.spyOn(f.store.jobs, 'get'); const isOwned = vi.spyOn(f.store.jobs, 'isCurrent');
    f.handle.close(); resources.delete(f.handle);
    paused.resolve();
    await vi.waitFor(() => expect(readdirSync(imageExecutor.canvasAssetsDir(f.dir, f.canvasId))).toEqual([]));
    expect(get).not.toHaveBeenCalled(); expect(isOwned).not.toHaveBeenCalled();
  });

  it('queries an old remote handle once and delivers its offline completion before evaluating timeout', async () => {
    const f = await fixture(); const accepted = startVideoNode(f.options); await accepted.submitted;
    stopVideoJobsForStore(f.store);
    f.handle.raw.prepare('UPDATE canvas_jobs SET submitted_at = ? WHERE id = ?').run(Date.now() - 11 * 60 * 1_000, accepted.job.id);
    mocks.submit.mockClear(); mocks.poll.mockResolvedValueOnce({ status: 'succeed', videoBuffer: Buffer.from('offline-completed') });
    const resumed = resumeVideoJobs({ canvasStore: f.store, settingsStore: settings, dataRoot: f.dir });
    await resumed[0].completion;
    expect(f.store.jobs.get(accepted.job.id)?.status).toBe('succeeded');
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.poll).toHaveBeenCalledOnce();
  });
});
