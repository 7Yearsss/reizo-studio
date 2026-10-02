import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SettingsStore } from './storage/settingsStore';
import { openDb, type DbHandle } from './db/client';
import { createSqliteSessionStore } from './storage/sqliteSessionStore';
import { createCanvasStore } from './storage/canvasStore';
import { createProviderStore } from './storage/providerStore';
import { mockAudioDriver } from './canvas/audioDrivers';

const ports = vi.hoisted(() => ({ base: 0 }));
const providers = vi.hoisted(() => ({ generateImage: vi.fn(), generateText: vi.fn(), streamText: vi.fn() }));
vi.mock('../../shared/constants', async (original) => ({
  ...await original<typeof import('../../shared/constants')>(),
  get API_BASE_PORT() { return ports.base; }, API_PORT_SCAN_ATTEMPTS: 5,
}));
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  }, desktopCapturer: {}, screen: {}, nativeImage: {},
}));
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), ...providers }));

import { startLocalServer, stopLocalServer, type RunningServer } from './listen';
import * as appModule from './app';
import { CanvasChannel } from './canvas/channel';

const handles = new Set<DbHandle>();
const dirs: string[] = [];
const runningServers = new Set<RunningServer>();
const blockers = new Set<Server>();
const settings = { get: async () => ({ activeProviderId: 'openai', providers: {} }) } as unknown as SettingsStore;

beforeEach(() => {
  for (const mock of Object.values(providers)) mock.mockReset().mockImplementation(() => { throw new Error('Unexpected provider call in server lifecycle'); });
});
afterEach(async () => {
  for (const running of runningServers) await stopLocalServer(running);
  runningServers.clear();
  for (const blocker of blockers) await new Promise<void>((resolve) => blocker.close(() => resolve()));
  blockers.clear();
  for (const handle of handles) handle.close();
  handles.clear();
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const dir of dirs.splice(0)) if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir())) rmSync(dir, { recursive: true });
  for (const mock of Object.values(providers)) expect(mock).not.toHaveBeenCalled();
});

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-listen-'));
  dirs.push(dir);
  const handle = openDb(path.join(dir, 'sessions.db'));
  handles.add(handle);
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('server-lifecycle', null, null);
  const store = createCanvasStore(handle);
  const canvasId = store.ensureCanvas(session.id).id;
  const node = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'cup' } }).node;
  return { dir, handle, sessions, store, canvasId, node };
}

/** Reserve a test-owned OS port; no existing application is stopped or modified. */
async function reserveBasePort(): Promise<Server> {
  const bind = async (port: number) => {
    const server = createServer((_req, response) => { response.end('test-owned port reservation'); });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    blockers.add(server);
    return server;
  };
  const release = async (server: Server) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    blockers.delete(server);
  };
  // Windows can assign a free base next to a reserved or occupied port. Probe
  // our required scan destination before using this pair in the real server test.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const blocker = await bind(0);
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('Expected an assigned loopback port');
    if (address.port === 65_535) { await release(blocker); continue; }
    try {
      const adjacent = await bind(address.port + 1);
      await release(adjacent);
      ports.base = address.port;
      return blocker;
    } catch (error) {
      await release(blocker);
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error;
    }
  }
  throw new Error('Could not reserve a test-owned loopback port with a usable adjacent port');
}

async function boundedStop(running: RunningServer) {
  let timeout: NodeJS.Timeout;
  try {
    await Promise.race([
      stopLocalServer(running),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Server stop waited for a live NDJSON reader')), 2_000); }),
    ]);
    runningServers.delete(running);
  } finally { clearTimeout(timeout); }
}

describe('local server lifecycle with canvas streams', () => {
  it('admits audio over HTTP, generates once through MiniMax, and replays the original job after inputs change', async () => {
    const f = await fixture();
    const wav = (await mockAudioDriver.synthesize({ prompt: 'local fixture', format: 'wav' }, {})).audioBuffer;
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const provider = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      requests.push({ method: request.method, path: request.url, body: body ? JSON.parse(body) : {} });
      if (request.method === 'POST' && request.url === '/v1/t2a_v2') {
        response.setHeader('content-type', 'audio/wav'); response.end(wav);
      } else { response.statusCode = 500; response.end('Unexpected request'); }
    });
    await new Promise<void>((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve); });
    blockers.add(provider);
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Expected a local audio provider port');
    const providerStore = createProviderStore(f.dir);
    await providerStore.upsert({
      id: 'audio-integration', name: 'Local test audio', category: 'audio', driverType: 'minimax', enabled: true,
      credentials: { apiKey: 'audio-integration-key', baseUrl: `http://127.0.0.1:${address.port}/v1` },
      sampleParams: { model: 'speech-01-turbo' },
    });
    const node = f.store.addNode(f.canvasId, { type: 'audio', x: 0, y: 0, w: 100, h: 100,
      params: { prompt: 'original narration', format: 'wav' } }).node;
    f.store.updateNode(f.canvasId, node.id, { output: { assets: ['prior.wav'] } });
    const reserved = await reserveBasePort();
    await new Promise<void>((resolve) => reserved.close(() => resolve())); blockers.delete(reserved);
    const running = await startLocalServer({ dataRoot: f.dir, db: f.handle, sessionStore: f.sessions, settingsStore: settings });
    runningServers.add(running);
    const run = () => fetch(`${running.origin}/api/canvas/${f.canvasId}/nodes/${node.id}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'audio-http-operation' },
      body: JSON.stringify({ confirmedSpend: true, providerId: 'audio-integration' }),
    });
    const response = await run();
    expect(response.status).toBe(202);
    const accepted = await response.json() as { jobId: string };
    expect(f.store.jobs.get(accepted.jobId)).toMatchObject({ nodeType: 'audio', generation: 1 });
    f.store.updateNode(f.canvasId, node.id, { params: { prompt: 'edited narration', format: 'mp3' } });
    await vi.waitFor(() => expect(f.store.jobs.get(accepted.jobId)?.status).toBe('succeeded'), { timeout: 5_000 });
    const replay = await run();
    expect(replay.status).toBe(202);
    expect((await replay.json() as { jobId: string }).jobId).toBe(accepted.jobId);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/v1/t2a_v2', body: { text: 'original narration', model: 'speech-01-turbo', audio_setting: { format: 'wav' } } });
    const job = f.store.jobs.get(accepted.jobId);
    expect(job).toMatchObject({ providerId: 'audio-integration', model: 'speech-01-turbo', generation: 1, input: { prompt: 'original narration' } });
    expect(JSON.stringify(job)).not.toContain('audio-integration-key');
    const completed = f.store.getNode(f.canvasId, node.id);
    expect(completed).toMatchObject({ runState: 'done', params: { prompt: 'edited narration' }, paramsHash: job.inputHash });
    expect(completed.output.assets[1]).toBe('prior.wav');
    const assetResponse = await fetch(`${running.origin}/api/canvas/assets/${completed.output.assets[0]}`);
    expect(assetResponse.status).toBe(200);
    expect(Buffer.from(await assetResponse.arrayBuffer())).toEqual(wav);
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(1);
    await boundedStop(running);
  });

  it('recovers a saved video through its original query endpoint after settings change, with no paid POST', async () => {
    const f = await fixture();
    const requests: Array<{ method: string; path: string; authorization: string | undefined }> = [];
    let fakeOrigin = '';
    const provider = createServer((request, response) => {
      requests.push({ method: request.method, path: request.url, authorization: request.headers.authorization });
      if (request.method === 'GET' && request.url === '/v1/videos/image2video/already-submitted') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: { task_status: 'succeed', task_result: { videos: [{ url: `${fakeOrigin}/result.mp4` }] } } }));
      } else if (request.method === 'GET' && request.url === '/result.mp4') {
        response.end(Buffer.from('test-video-result'));
      } else { response.statusCode = 500; response.end('Unexpected provider dispatch'); }
    });
    await new Promise<void>((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve); });
    blockers.add(provider);
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Expected a local fake provider port');
    fakeOrigin = `http://127.0.0.1:${address.port}`;
    const node = f.store.addNode(f.canvasId, {
      type: 'video', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'saved prompt', provider: 'kling' },
    }).node;
    const job = f.store.jobs.enqueue({
      canvasId: f.canvasId, nodeId: node.id, nodeType: 'video', inputHash: 'original-input-hash',
      input: { node, driverId: 'kling', params: { prompt: 'saved prompt' }, references: [], request: { providerId: 'openai' } },
    });
    f.store.jobs.markSubmitted(job.id, { providerId: 'openai', model: 'kling-v1' });
    f.store.jobs.recordRemoteTask(job.id, {
      driverId: 'kling', taskId: 'already-submitted', context: { baseUrl: fakeOrigin, queryPath: '/v1/videos/image2video' },
    });
    f.store.updateNode(f.canvasId, node.id, { runState: 'running', output: { assets: ['existing.mp4'] } });
    const reserved = await reserveBasePort();
    await new Promise<void>((resolve) => reserved.close(() => resolve()));
    blockers.delete(reserved);
    const changedSettings = { get: async () => ({ activeProviderId: 'openai', providers: {
      openai: { apiKey: 'fresh-test-key', baseUrl: 'https://changed.invalid/v1' },
    } }) } as unknown as SettingsStore;
    const running = await startLocalServer({ dataRoot: f.dir, db: f.handle, sessionStore: f.sessions, settingsStore: changedSettings });
    runningServers.add(running);
    await vi.waitFor(() => expect(f.store.jobs.get(job.id)?.status).toBe('succeeded'), { timeout: 8_000 });
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/v1/videos/image2video/already-submitted'], ['GET', '/result.mp4'],
    ]);
    expect(requests[0].authorization).toBe('Bearer fresh-test-key');
    expect(requests[1].authorization).toBeUndefined();
    expect(f.store.jobs.get(job.id)).toMatchObject({ generation: 1, remoteTask: { taskId: 'already-submitted' } });
    const completed = f.store.getNode(f.canvasId, node.id);
    expect(completed).toMatchObject({ runState: 'done', paramsHash: 'original-input-hash' });
    expect(completed.output.assets).toContain('existing.mp4');
    expect(readFileSync(path.join(f.dir, 'canvas', completed.output.assets[0])).toString()).toBe('test-video-result');
    await boundedStop(running);
  });

  it('stops a live v2 stream without waiting for its reader or heartbeat, releases the timer, and permits immediate SQLite close', async () => {
    const f = await fixture();
    const reserved = await reserveBasePort();
    await new Promise<void>((resolve) => reserved.close(() => resolve()));
    blockers.delete(reserved);
    let streamingStore: Parameters<CanvasChannel['streamCommits']>[0];
    const originalStream = CanvasChannel.prototype.streamCommits;
    vi.spyOn(CanvasChannel.prototype, 'streamCommits').mockImplementation(function (store, after, signal) {
      streamingStore = store;
      return originalStream.call(this, store, after, signal);
    });
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const clears = vi.spyOn(globalThis, 'clearInterval');
    const running = await startLocalServer({ dataRoot: f.dir, db: f.handle, sessionStore: f.sessions, settingsStore: settings });
    runningServers.add(running);
    const response = await fetch(`${running.origin}/api/canvas/${f.canvasId}/stream?protocol=2&after=0`);
    expect(response.status).toBe(200);
    if (!response.body) throw new Error('Expected an NDJSON response');
    const reader = response.body.getReader();
    const first = await reader.read();
    expect(JSON.parse(new TextDecoder().decode(first.value).trim())).toMatchObject({ v: 2, kind: 'commit', commit: { revision: 1 } });
    const heartbeatIndex = intervals.mock.calls.findIndex((call) => call[1] === 15_000);
    expect(heartbeatIndex).toBeGreaterThanOrEqual(0);
    const heartbeat = intervals.mock.results[heartbeatIndex].value;
    const heartbeatRead = vi.spyOn(streamingStore, 'getCanvas');
    const disconnected = reader.read().catch(() => ({ done: true }));
    await boundedStop(running);
    await disconnected;
    reader.releaseLock();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(clears).toHaveBeenCalledWith(heartbeat);
    heartbeatRead.mockClear();
    f.handle.close(); handles.delete(f.handle);
    expect(() => running.stopCanvasJobs()).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(heartbeatRead).not.toHaveBeenCalled();
  });

  it('disposes a failed occupied-port attempt and repeated recovery preserves one job generation and outcome', async () => {
    const f = await fixture();
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: f.node.id, nodeType: f.node.type, input: {}, operationId: 'recover-once' });
    f.store.jobs.markSubmitted(job.id, { providerId: 'openai', model: 'image-model' });
    f.store.updateNode(f.canvasId, f.node.id, { runState: 'running', output: { assets: ['old.png'], text: 'saved' } });
    const beforeRevision = f.store.getCanvas(f.canvasId)?.liveRevision;
    await reserveBasePort();
    const attempts: Array<{ app: ReturnType<typeof appModule.createApp>; stop: ReturnType<typeof vi.spyOn>; start: ReturnType<typeof vi.spyOn> }> = [];
    const originalApp = appModule.createApp;
    vi.spyOn(appModule, 'createApp').mockImplementation((options) => {
      const app = originalApp(options);
      const stop = vi.spyOn(app, 'stopCanvasJobs');
      const start = vi.spyOn(app, 'startCanvasJobs');
      attempts.push({ app, stop, start });
      return app;
    });
    const running = await startLocalServer({ dataRoot: f.dir, db: f.handle, sessionStore: f.sessions, settingsStore: settings });
    runningServers.add(running);
    expect(running.port).toBeGreaterThan(ports.base);
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0].stop).toHaveBeenCalledOnce();
    expect(attempts[0].start).not.toHaveBeenCalled();
    expect(attempts.at(-1).start).toHaveBeenCalledOnce();
    const rejected = await attempts[0].app.request(`http://127.0.0.1:${ports.base}/api/canvas/${f.canvasId}/nodes/${f.node.id}/run`, {
      method: 'POST', headers: { host: `127.0.0.1:${ports.base}`, 'content-type': 'application/json' }, body: JSON.stringify({ confirmedSpend: true }),
    });
    expect(rejected.status).toBe(503);
    expect(f.store.jobs.list(f.canvasId)).toHaveLength(1);
    expect(f.store.jobs.get(job.id)).toMatchObject({ generation: 1, status: 'interrupted', cancelReason: 'restart' });
    expect(f.store.getNode(f.canvasId, f.node.id)).toMatchObject({ runState: 'error', output: { assets: ['old.png'], text: 'saved' } });
    expect(f.store.getCanvas(f.canvasId)?.liveRevision).toBe(beforeRevision + 1);
    const savedJob = f.store.jobs.get(job.id);
    await boundedStop(running);
    expect(f.store.jobs.get(job.id)).toEqual(savedJob);
    expect(f.store.getCanvas(f.canvasId)?.liveRevision).toBe(beforeRevision + 1);
  });
});
