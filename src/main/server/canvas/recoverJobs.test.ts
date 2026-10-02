import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CanvasNodeType } from '../../../shared/canvas';
import type { SettingsStore } from '../storage/settingsStore';
import { openDb, type DbHandle } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';

const providers = vi.hoisted(() => ({ generateImage: vi.fn(), generateText: vi.fn(), streamText: vi.fn() }));
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  }, desktopCapturer: {}, screen: {}, nativeImage: {},
}));
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), ...providers }));

import { createApp } from '../app';
import { INTERRUPTED_JOB_MESSAGE, recoverCanvasJobs } from './recoverJobs';
import * as audioDrivers from './audioDrivers';

const handles = new Set<DbHandle>();
const dirs: string[] = [];
const apps = new Set<ReturnType<typeof createApp>>();
const settings = { get: async () => ({ activeProviderId: 'openai', providers: {} }) } as unknown as SettingsStore;
beforeEach(() => {
  for (const mock of Object.values(providers)) mock.mockReset().mockImplementation(() => { throw new Error('Unexpected provider call during recovery'); });
});
afterEach(async () => {
  for (const app of apps) app.stopCanvasJobs();
  apps.clear();
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  // Let unrelated file-store initialization finish before removing test-owned directories.
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const dir of dirs.splice(0)) if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir())) rmSync(dir, { recursive: true });
  for (const mock of Object.values(providers)) expect(mock).not.toHaveBeenCalled();
});

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-recovery-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'sessions.db');
  const handle = openDb(dbPath);
  handles.add(handle);
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('recovery', null, null);
  const store = createCanvasStore(handle);
  const canvasId = store.ensureCanvas(session.id).id;
  const addNode = (type: CanvasNodeType = 'image') => store.addNode(canvasId, {
    type, x: 0, y: 0, w: 100, h: 100, params: { prompt: 'cup', instruction: 'critique' },
  }).node;
  const startApp = (db = handle) => {
    const app = createApp({ dataRoot: dir, port: 47_199, db, settingsStore: settings, sessionStore: createSqliteSessionStore(db) });
    apps.add(app);
    return app;
  };
  return { dir, dbPath, handle, sessions, store, canvasId, addNode, startApp };
}

describe('canvas job recovery and host lifecycle', () => {
  it('interrupts saved queued and submitted audio jobs after reopen without synthesis or extra generations', async () => {
    const f = await fixture();
    const nodes = [f.addNode('audio'), f.addNode('audio')];
    const jobs = nodes.map((node, index) => {
      f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: {
        assets: [`saved-${index}.wav`], resultSet: [{ asset: `saved-${index}.wav`, model: 'previous-model' }], progress: 20,
      } });
      return f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: 'audio', operationId: `saved-audio-${index}`, input: { params: { prompt: 'saved speech' } } });
    });
    f.store.jobs.markSubmitted(jobs[1].id, { providerId: 'original-audio-provider', model: 'actual-speech-model' });
    f.handle.close(); handles.delete(f.handle);
    const reopened = openDb(f.dbPath);
    handles.add(reopened);
    const restored = createCanvasStore(reopened);
    const driverLookup = vi.spyOn(audioDrivers, 'getAudioDriver');
    const app = f.startApp(reopened);
    app.startCanvasJobs();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(driverLookup).not.toHaveBeenCalled();
    for (const [index, node] of nodes.entries()) {
      expect(restored.jobs.get(jobs[index].id)).toMatchObject({ status: 'interrupted', generation: 1, input: { params: { prompt: 'saved speech' } } });
      expect(restored.getNode(f.canvasId, node.id)).toMatchObject({ runState: 'error', output: {
        assets: [`saved-${index}.wav`], resultSet: [{ asset: `saved-${index}.wav` }], error: INTERRUPTED_JOB_MESSAGE,
      } });
    }
    expect(restored.jobs.get(jobs[1].id)?.submittedAt).toEqual(expect.any(String));
    const saved = restored.jobs.list(f.canvasId);
    const nextApp = f.startApp(reopened);
    nextApp.startCanvasJobs();
    app.stopCanvasJobs(); nextApp.stopCanvasJobs();
    expect(restored.jobs.list(f.canvasId)).toEqual(saved);
    expect(restored.jobs.list(f.canvasId)).toHaveLength(2);
    expect(driverLookup).not.toHaveBeenCalled();
  });

  it('repairs completed audio projection from its saved result without synthesizing another task', async () => {
    const f = await fixture();
    const node = f.addNode('audio');
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: 'audio', input: {}, inputHash: 'submitted-audio-hash' });
    f.store.jobs.finish(job.id, 'succeeded', { result: { assets: ['finished.wav', 'previous.wav'], resultSet: [{ asset: 'finished.wav', model: 'actual-model' }] } });
    f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['previous.wav'], progress: 98 } });
    const saved = f.store.jobs.get(job.id);
    expect(recoverCanvasJobs(f.store)).toEqual({ interrupted: 0, legacy: 0, repaired: 1 });
    expect(f.store.getNode(f.canvasId, node.id)).toMatchObject({ runState: 'done', paramsHash: 'submitted-audio-hash', output: { assets: ['finished.wav', 'previous.wav'] } });
    expect(f.store.getNode(f.canvasId, node.id)?.output?.progress).toBeUndefined();
    expect(f.store.jobs.get(job.id)).toEqual(saved);
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(1);
  });

  it('preserves a recoverable remote video generation across restart and shutdown without resubmitting it', async () => {
    const f = await fixture();
    const node = f.addNode('video');
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: 'video', input: {}, operationId: 'saved-video' });
    f.store.jobs.markSubmitted(job.id, { providerId: 'kling', model: 'kling-v1' });
    f.store.jobs.recordRemoteTask(job.id, {
      driverId: 'kling', taskId: 'existing-task',
      context: { baseUrl: 'https://api.klingai.com', queryPath: '/v1/videos/image2video' },
    });
    f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['saved.mp4'], progress: 40 } });
    const saved = f.store.jobs.get(job.id);
    const snapshot = f.store.getSnapshot(f.canvasId);
    f.handle.close(); handles.delete(f.handle);
    const reopened = openDb(f.dbPath);
    handles.add(reopened);
    const restored = createCanvasStore(reopened);
    const app = f.startApp(reopened);
    expect(restored.jobs.get(job.id)).toEqual(saved);
    expect(restored.getSnapshot(f.canvasId)).toEqual(snapshot);
    expect(recoverCanvasJobs(restored)).toEqual({ interrupted: 0, legacy: 0, repaired: 0 });
    app.stopCanvasJobs();
    expect(restored.jobs.get(job.id)).toEqual(saved);
    expect(restored.jobs.list(f.canvasId)).toHaveLength(1);
    expect(restored.getNode(f.canvasId, node.id)).toMatchObject({ runState: 'running', output: { assets: ['saved.mp4'] } });
  });

  it('interrupts video attempts with missing or unusable query context, including process-local mock tasks', async () => {
    const f = await fixture();
    for (const remoteTask of [
      undefined,
      { driverId: 'mock', taskId: 'lost-process-local-task' },
      { driverId: 'kling', taskId: 'missing-context' },
      { driverId: 'kling', taskId: 'invalid-context', context: { baseUrl: 'https://api.klingai.com', queryPath: '/unrelated' } },
    ]) {
      const node = f.addNode('video');
      const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: 'video', input: {} });
      f.store.jobs.markSubmitted(job.id, { providerId: 'kling' });
      if (remoteTask) f.store.jobs.recordRemoteTask(job.id, remoteTask);
      f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['old.mp4'] } });
    }
    expect(recoverCanvasJobs(f.store)).toEqual({ interrupted: 4, legacy: 0, repaired: 4 });
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(4);
    expect(f.store.jobs.list(f.canvasId).every((job) => job.status === 'interrupted' && job.generation === 1)).toBe(true);
  });

  it('repairs a saved terminal video result without inventing a legacy attempt', async () => {
    const f = await fixture();
    const node = f.addNode('video');
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: 'video', input: {}, inputHash: 'submitted-hash' });
    f.store.jobs.finish(job.id, 'succeeded', { result: { assets: ['finished.mp4'] } });
    f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['old.mp4'], progress: 90 } });
    expect(recoverCanvasJobs(f.store)).toEqual({ interrupted: 0, legacy: 0, repaired: 1 });
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(1);
    expect(f.store.getNode(f.canvasId, node.id)).toMatchObject({ runState: 'done', paramsHash: 'submitted-hash', output: { assets: ['finished.mp4'] } });
  });

  it('recovers queued and submitted jobs after real database reopen and repeated app startup makes no extra writes', async () => {
    const f = await fixture();
    const queued = f.addNode();
    const running = f.addNode();
    for (const node of [queued, running]) f.store.updateNode(f.canvasId, node.id, {
      output: { assets: [`${node.id}-old.png`], text: 'saved draft', progress: 30 }, runState: 'running',
    });
    const jobs = [queued, running].map((node, i) => f.store.jobs.enqueue({
      canvasId: f.canvasId, nodeId: node.id, nodeType: node.type, input: { params: node.params }, operationId: `operation-${i}`,
    }));
    f.store.jobs.markSubmitted(jobs[1].id, { providerId: 'openai', model: 'image-model' });
    const beforeRevision = f.store.getCanvas(f.canvasId)?.liveRevision;
    f.handle.close(); handles.delete(f.handle);
    const reopened = openDb(f.dbPath);
    handles.add(reopened);
    const restored = createCanvasStore(reopened);
    f.startApp(reopened);
    for (const node of [queued, running]) {
      expect(restored.getNode(f.canvasId, node.id)).toMatchObject({
        runState: 'error', output: { assets: [`${node.id}-old.png`], text: 'saved draft', error: INTERRUPTED_JOB_MESSAGE },
      });
      expect(restored.getNode(f.canvasId, node.id)?.output?.progress).toBeUndefined();
    }
    expect(restored.jobs.list(f.canvasId).map((job) => job.status)).toEqual(['interrupted', 'interrupted']);
    expect(restored.getCanvas(f.canvasId)?.liveRevision).toBe(beforeRevision + 1);
    const savedJobs = restored.jobs.list(f.canvasId);
    const savedSnapshot = restored.getSnapshot(f.canvasId);
    f.startApp(reopened);
    expect(restored.jobs.list(f.canvasId)).toEqual(savedJobs);
    expect(restored.getSnapshot(f.canvasId)).toEqual(savedSnapshot);
    expect(recoverCanvasJobs(restored)).toEqual({ interrupted: 0, legacy: 0, repaired: 0 });
  });

  it('records one interruption for each legacy running media/agent node while preserving delivered content', async () => {
    const f = await fixture();
    const nodes = (['image', 'video', 'audio', 'agent'] as const).map(f.addNode);
    for (const node of nodes) f.store.updateNode(f.canvasId, node.id, {
      runState: 'running', output: { assets: [`${node.type}-old.asset`], text: 'saved text', progress: 15 },
    });
    const before = f.store.getCanvas(f.canvasId)?.liveRevision;
    expect(recoverCanvasJobs(f.store)).toEqual({ interrupted: 0, legacy: 4, repaired: 4 });
    expect(f.store.getCanvas(f.canvasId)?.liveRevision).toBe(before + 1);
    for (const node of nodes) {
      const job = f.store.jobs.current(f.canvasId, node.id);
      expect(job).toMatchObject({ generation: 1, status: 'interrupted', input: { legacy: true }, cancelReason: 'restart' });
      expect(f.store.getNode(f.canvasId, node.id)).toMatchObject({
        runState: 'error', output: { assets: [`${node.type}-old.asset`], text: 'saved text', error: INTERRUPTED_JOB_MESSAGE },
      });
    }
    expect(recoverCanvasJobs(f.store)).toEqual({ interrupted: 0, legacy: 0, repaired: 0 });
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(4);
  });

  it.each([
    ['succeeded', 'done'], ['failed', 'error'], ['cancelled', 'idle'], ['interrupted', 'error'],
  ] as const)('repairs stale running UI from immutable %s outcome', async (status, runState) => {
    const f = await fixture();
    const node = f.addNode();
    f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['old.png'], text: 'old text', progress: 90, error: 'old error' } });
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: node.type, input: { params: node.params }, inputHash: 'saved-hash' });
    f.store.jobs.finish(job.id, status, status === 'succeeded'
      ? { result: { assets: ['new.png', 'old.png'], text: 'completed text' } }
      : status === 'cancelled' ? { cancelReason: 'user_cancelled' } : { error: 'saved terminal error' });
    const savedJob = f.store.jobs.get(job.id);
    expect(recoverCanvasJobs(f.store)).toEqual({ interrupted: 0, legacy: 0, repaired: 1 });
    const repaired = f.store.getNode(f.canvasId, node.id);
    expect(repaired?.runState).toBe(runState);
    expect(repaired?.output?.progress).toBeUndefined();
    if (status === 'succeeded') {
      expect(repaired?.output).toMatchObject({ assets: ['new.png', 'old.png'], text: 'completed text' });
      expect(repaired?.paramsHash).toBe('saved-hash');
      expect(repaired?.output?.error).toBeUndefined();
    } else {
      expect(repaired?.output).toMatchObject({ assets: ['old.png'], text: 'old text' });
      expect(repaired?.output?.error).toBe(status === 'cancelled' ? undefined : 'saved terminal error');
    }
    expect(f.store.jobs.get(job.id)).toEqual(savedJob);
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(1);
  });

  it.each([{}, { assets: [] as string[], text: '  ' }, { assets: [''] }, { assets: ['  '] }])('does not infer success from unusable saved result %j', async (result) => {
    const f = await fixture();
    const node = f.addNode();
    f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['old.png'], text: 'old text' } });
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: node.type, input: {} });
    f.store.jobs.finish(job.id, 'succeeded', { result });
    recoverCanvasJobs(f.store);
    expect(f.store.getNode(f.canvasId, node.id)).toMatchObject({ runState: 'error', output: { assets: ['old.png'], text: 'old text' } });
    expect(f.store.getNode(f.canvasId, node.id)?.output?.error).toContain('结果不可用');
    expect(f.store.jobs.get(job.id)?.status).toBe('succeeded');
  });

  it('interrupts a deleted node historical job without recreating or projecting that node', async () => {
    const f = await fixture();
    const node = f.addNode();
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: node.type, input: {}, operationId: 'deleted' });
    f.store.jobs.markSubmitted(job.id, { providerId: 'openai' });
    f.store.deleteNode(f.canvasId, node.id);
    const revision = f.store.getCanvas(f.canvasId)?.liveRevision;
    expect(recoverCanvasJobs(f.store)).toEqual({ interrupted: 1, legacy: 0, repaired: 0 });
    expect(f.store.getNode(f.canvasId, node.id)).toBeNull();
    expect(f.store.getCanvas(f.canvasId)?.liveRevision).toBe(revision);
    expect(f.store.jobs.get(job.id)).toMatchObject({ status: 'interrupted', operationId: 'deleted', generation: 1 });
  });

  it('rolls back every recovery ledger/projection change if any projection fails', async () => {
    const f = await fixture();
    const nodes = [f.addNode(), f.addNode()];
    const jobs = nodes.map((node) => {
      f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['saved.png'] } });
      return f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: node.type, input: {} });
    });
    f.store.jobs.markSubmitted(jobs[1].id);
    const before = f.store.getSnapshot(f.canvasId);
    const beforeJobs = f.store.jobs.list(f.canvasId);
    const update = f.store.updateNode.bind(f.store);
    let writes = 0;
    const failure = vi.spyOn(f.store, 'updateNode').mockImplementation((...args) => {
      writes += 1;
      if (writes === 2) throw new Error('projection unavailable');
      return update(...args);
    });
    expect(() => recoverCanvasJobs(f.store)).toThrow('projection unavailable');
    expect(f.store.getSnapshot(f.canvasId)).toEqual(before);
    expect(f.store.jobs.list(f.canvasId)).toEqual(beforeJobs);
    failure.mockRestore();
    expect(recoverCanvasJobs(f.store).interrupted).toBe(2);
  });

  it('host shutdown interrupts pending jobs once and rejects new image admission without a provider request', async () => {
    const f = await fixture();
    const node = f.addNode();
    const app = f.startApp();
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: node.type, input: {} });
    f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['saved.png'] } });
    app.stopCanvasJobs();
    expect(f.store.jobs.get(job.id)).toMatchObject({ status: 'interrupted', cancelReason: 'shutdown' });
    const after = f.store.jobs.get(job.id);
    app.stopCanvasJobs();
    expect(f.store.jobs.get(job.id)).toEqual(after);
    const response = await app.request(`http://127.0.0.1:47199/api/canvas/${f.canvasId}/nodes/${node.id}/run`, {
      method: 'POST', headers: { host: '127.0.0.1:47199', 'content-type': 'application/json' }, body: JSON.stringify({ confirmedSpend: true }),
    });
    expect(response.status).toBe(503);
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(1);
  });
});
