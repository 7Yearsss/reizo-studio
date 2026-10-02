import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createCanvasRouter } from './canvas';
import { nodeJobsFor } from '../canvas/nodeJobs';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateImage: generate }));
vi.mock('../agent/provider/openai', () => ({ createOpenAiProvider: () => ({ image: (id: string) => ({ id }) }) }));
const settings = { get: async () => ({ activeProviderId: 'openai', providers: {
  openai: { apiKey: 'test-key', baseUrl: 'https://example.test/v1' },
} }) } as unknown as SettingsStore;
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => { generate.mockReset(); });
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });

async function fixture() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const store = createCanvasStore(handle);
  const session = await sessions.create('jobs', null, null);
  const canvasId = store.ensureCanvas(session.id).id;
  const node = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100,
    params: { prompt: 'product', size: '1024x1024' } }).node;
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-job-http-'));
  const app = new Hono().route('/api/canvas', createCanvasRouter(store, settings, sessions, dataRoot));
  cleanup.push(async () => {
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
