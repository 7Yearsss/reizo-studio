import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import type { LocalSettings } from '../../../shared/settings';
import { createCanvasRouter } from './canvas';
import { nodeJobsFor } from '../canvas/nodeJobs';
import { getActiveJob, stopVideoJobsForStore } from '../canvas/asyncJobManager';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateImage: generate }));
vi.mock('../agent/provider/openai', () => ({ createOpenAiProvider: () => ({ image: (id: string) => ({ id }) }) }));
const settings = { get: async () => ({ activeProviderId: 'openai', providers: {
  openai: { apiKey: 'test-key', baseUrl: 'https://example.test/v1' },
} }) } as unknown as SettingsStore;
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => { generate.mockReset(); });
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function fixture(currentSettings = settings) {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const store = createCanvasStore(handle);
  const session = await sessions.create('jobs', null, null);
  const canvasId = store.ensureCanvas(session.id).id;
  const node = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100,
    params: { prompt: 'product', size: '1024x1024' } }).node;
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-job-http-'));
  const app = new Hono().route('/api/canvas', createCanvasRouter(store, currentSettings, sessions, dataRoot));
  cleanup.push(async () => {
    stopVideoJobsForStore(store);
    nodeJobsFor(store).shutdown();
    handle.close();
    if (path.dirname(path.resolve(dataRoot)) === path.resolve(os.tmpdir())) await rm(dataRoot, { recursive: true, force: true });
  });
  const run = (operationId: string, nodeId = node.id, confirmedSpend = true) => app.request(`/api/canvas/${canvasId}/nodes/${nodeId}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId },
    body: JSON.stringify({ confirmedSpend }),
  });
  return { handle, store, canvasId, node, app, run };
}

describe('durable canvas job HTTP interface', () => {
  it('recovers a timed-out video by GET only and follows the saved recovery without rewriting its history', async () => {
    vi.useFakeTimers();
    const account = { get: async () => ({ providers: { 'reizo-account': { apiKey: 'sk-fixture', baseUrl: 'https://gateway.example/v1' } },
      accountCatalog: { text: [], image: [], video: [] } } as unknown as LocalSettings) } as unknown as SettingsStore;
    const f = await fixture(account);
    const video = f.store.addNode(f.canvasId, { type: 'video', x: 0, y: 0, w: 100, h: 100, params: {} }).node;
    const original = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: video.id, nodeType: 'video',
      input: { driverId: 'new-api', params: { prompt: 'saved', model: 'hidden-model' }, request: { providerId: 'reizo-account' } } });
    f.store.jobs.markSubmitted(original.id, { providerId: 'reizo-account', model: 'hidden-model' });
    f.store.jobs.recordRemoteTask(original.id, { driverId: 'new-api', taskId: 'remote-task', context: { baseUrl: 'https://gateway.example/v1' } });
    f.store.jobs.finish(original.id, 'interrupted', { error: '视频查询超过 10 分钟', cancelReason: 'query_uncertain' });
    const history = f.store.jobs.get(original.id);
    let completed = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET');
      return new Response(url.endsWith('/content') ? 'video-bytes' : JSON.stringify({
      status: completed ? 'completed' : 'in_progress', progress: 50,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    const endpoint = `/api/canvas/${f.canvasId}/jobs/${original.id}`;
    expect((await f.app.request(`/api/canvas/foreign/jobs/${original.id}/query`, { method: 'POST' })).status).toBe(404);
    expect((await f.app.request(`/api/canvas/${f.canvasId}/jobs/missing/query`, { method: 'POST' })).status).toBe(404);
    const accepted = await f.app.request(`${endpoint}/query`, { method: 'POST' });
    expect(accepted.status).toBe(202);
    const { job } = await accepted.json();
    const again = await (await f.app.request(`${endpoint}/query`, { method: 'POST' })).json();
    expect(again.job.id).toBe(job.id);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const observed = await (await f.app.request(endpoint)).json();
    expect(observed.job).toEqual(history);
    expect(observed.recoveryJob.observation).toMatchObject({ status: 'processing', progress: 50 });
    const completion = getActiveJob(f.canvasId, video.id, f.store).completion;
    completed = true;
    vi.advanceTimersByTime(2500); await completion;
    const restored = await (await f.app.request(endpoint)).json();
    expect(restored.recoveryJob).toMatchObject({ id: job.id, status: 'succeeded' });
    expect(restored.recoveryJob.result.assets).toHaveLength(1);
    expect(restored.job).toEqual(history);
    expect(fetcher.mock.calls.every(call => !(call[1] as RequestInit)?.method || (call[1] as RequestInit).method === 'GET')).toBe(true);
  });

  it('returns an accepted durable job ID and reuses it without resubmitting paid work', async () => {
    const { store, run, canvasId } = await fixture();
    generate.mockImplementation(() => new Promise<void>((): void => undefined));
    const first = await run('same-operation');
    expect(first.status).toBe(202);
    const body = await first.json();
    expect(store.jobs.get(body.jobId)).toMatchObject({ operationId: 'same-operation', canvasId });
    const retry = await run('same-operation');
    expect((await retry.json()).jobId).toBe(body.jobId);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(store.jobs.list(canvasId)).toHaveLength(1);
  });

  it('reports admission failure before HTTP 202 and never calls the provider', async () => {
    const { handle, store, run, canvasId } = await fixture();
    handle.raw.exec("CREATE TRIGGER fail_job_admission BEFORE INSERT ON canvas_jobs BEGIN SELECT RAISE(ABORT, 'admission unavailable'); END");
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await run('not-accepted');
    expect(failed.status).toBe(500);
    expect(store.jobs.list(canvasId)).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('retains the spend gate and rejects new admission during shutdown', async () => {
    const { store, run, canvasId } = await fixture();
    expect((await run('without-spend', undefined, false)).status).toBe(402);
    nodeJobsFor(store).shutdown();
    expect((await run('closed')).status).toBe(503);
    expect(store.jobs.list(canvasId)).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects operation identity reuse for another node', async () => {
    const { store, run, canvasId } = await fixture();
    generate.mockImplementation(() => new Promise<void>((): void => undefined));
    expect((await run('identity')).status).toBe(202);
    const other = store.addNode(canvasId, { type: 'image', x: 100, y: 0, w: 100, h: 100,
      params: { prompt: 'other', size: '1024x1024' } }).node;
    expect((await run('identity', other.id)).status).toBe(409);
    expect(store.jobs.list(canvasId)).toHaveLength(1);
  });

  it('lists credential-free summaries and returns history only in its owning canvas', async () => {
    const { store, run, app, canvasId } = await fixture();
    generate.mockImplementation(() => new Promise<void>((): void => undefined));
    const accepted = await (await run('history')).json();
    const summaries = await (await app.request(`/api/canvas/${canvasId}/jobs`)).json();
    expect(summaries.jobs[0]).toMatchObject({ id: accepted.jobId });
    expect(summaries.jobs[0]).not.toHaveProperty('input');
    expect(summaries.jobs[0]).not.toHaveProperty('result');
    const detail = await (await app.request(`/api/canvas/${canvasId}/jobs/${accepted.jobId}`)).json();
    expect(detail.job.input.node.params.prompt).toBe('product');
    expect(JSON.stringify(detail)).not.toContain('test-key');
    expect((await app.request(`/api/canvas/foreign/jobs/${accepted.jobId}`)).status).toBe(404);
    expect((await app.request('/api/canvas/foreign/jobs')).status).toBe(404);
    expect((await app.request(`/api/canvas/${canvasId}/jobs?limit=0`)).status).toBe(400);
    expect((await app.request(`/api/canvas/${canvasId}/jobs?limit=501`)).status).toBe(400);
    expect((await (await app.request(`/api/canvas/${canvasId}/jobs?limit=1`)).json()).jobs).toHaveLength(1);
    expect(store.jobs.get(accepted.jobId)).not.toBeNull();
  });
});
