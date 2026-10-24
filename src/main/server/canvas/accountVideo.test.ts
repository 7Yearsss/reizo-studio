import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createCanvasTools } from '../agent/canvasTools';
import { canvasAssetsDir } from './assets';
import { getActiveJob, stopVideoJobsForStore } from './videoJobRuntime';
import { stopCanvasWork } from './workLifecycle';
import type { VideoModelSupport } from '../../../shared/modelCatalog';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function fixture(known: boolean) {
  const handle = openDb(':memory:'); const store = createCanvasStore(handle);
  const session = await createSqliteSessionStore(handle).create('video', null, null); const canvas = store.ensureCanvas(session.id);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reizo-account-video-'));
  cleanups.push(async () => { stopVideoJobsForStore(store); stopCanvasWork(store); handle.close(); if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir())) throw Error('Unsafe test directory'); await rm(dir, { recursive: true, force: true }); });
  await mkdir(canvasAssetsDir(dir, canvas.id), { recursive: true }); await writeFile(path.join(canvasAssetsDir(dir, canvas.id), 'fixture.png'), Buffer.from([137,80,78,71]));
  const image = store.addNode(canvas.id, { type: 'image', title: 'reference', x: 0, y: 0, w: 100, h: 100, params: { prompt: '' } }).node;
  store.updateNode(canvas.id, image.id, { output: { assets: [`${canvas.id}/fixture.png`] }, runState: 'done' });
  const video = store.addNode(canvas.id, { type: 'video', x: 200, y: 0, w: 100, h: 100, params: { prompt: `animate @[reference](canvas:${image.id})`, duration: '5s', ratio: '16:9' } }).node;
  store.addEdge(canvas.id, { sourceId: image.id, targetId: video.id, sourceHandle: 'image_out', targetHandle: 'start_frame' });
  const support: VideoModelSupport = { startFrame: known, endFrame: false, reference: known, camera: false, ...(known ? { fields: ['model', 'prompt', 'seconds', 'aspect_ratio', 'images'], minSeconds: 1, maxSeconds: 15, aspectRatios: ['16:9'] } : {}) };
  const settingsStore = { get: async () => ({ activeProviderId: 'reizo-account', providers: { 'reizo-account': { apiKey: 'fixture-only', baseUrl: 'https://gateway.example/v1' } }, mediaModels: { video: 'grok-imagine-video' }, accountCatalog: { text: [] as unknown[], image: [] as unknown[], video: [{ id: 'grok-imagine-video', name: 'Grok', protocol: 'openai-video', video: support }] } }) } as unknown as SettingsStore;
  const { tools } = createCanvasTools({ sessionId: session.id, canvasStore: store, settingsStore, dataRoot: dir });
  const run = tools.run_node.execute as unknown as (input: { id: string; wait: boolean }, options: { toolCallId: string }) => Promise<Record<string, unknown>>;
  return { store, canvas, video, run, dir };
}

it('reports a local validation failure instead of claiming the video was queued upstream', async () => {
  const f = await fixture(false); const transport = vi.fn(); vi.stubGlobal('fetch', transport);
  const result = await f.run({ id: f.video.id, wait: false }, { toolCallId: 'fixture' });
  expect(result).toMatchObject({ ok: false, status: 'error', jobStatus: 'failed', model: 'grok-imagine-video', providerId: 'reizo-account', submissionStatus: 'not_submitted' });
  const job = f.store.jobs.get(String(result.jobId));
  expect(job.submittedAt).toBeUndefined(); expect(job.remoteTask).toBeUndefined(); expect(transport).not.toHaveBeenCalled();
});

it('submits one deduplicated reference using the account model and returns the remote receipt', async () => {
  const f = await fixture(true);
  const transport = vi.fn().mockResolvedValue(Response.json({ id: 'video_fixture' })); vi.stubGlobal('fetch', transport);
  const result = await f.run({ id: f.video.id, wait: false }, { toolCallId: 'fixture' });
  expect(result).toMatchObject({ ok: true, model: 'grok-imagine-video', providerId: 'reizo-account', remoteTaskId: 'video_fixture', submissionStatus: 'submitted' });
  const [url, init] = transport.mock.calls[0];
  expect(url).toBe('https://gateway.example/v1/videos'); expect(init.headers.Authorization).toBe('Bearer fixture-only');
  expect(JSON.parse(init.body)).toMatchObject({ model: 'grok-imagine-video', seconds: '5', aspect_ratio: '16:9', images: [expect.stringMatching(/^data:image\/png;base64,/)] });
  expect(JSON.parse(init.body).images).toHaveLength(1); expect(transport).toHaveBeenCalledOnce();
});

it('polls the accepted account task and commits its authenticated video download to the canvas', async () => {
  vi.useFakeTimers();
  const f = await fixture(true);
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ id: 'video_fixture' }))
    .mockResolvedValueOnce(Response.json({ status: 'completed' })).mockResolvedValueOnce(new Response(Buffer.from('fixture video')));
  vi.stubGlobal('fetch', transport);
  const result = await f.run({ id: f.video.id, wait: false }, { toolCallId: 'fixture' });
  const active = getActiveJob(f.canvas.id, f.video.id, f.store);
  if (!active) throw Error('Expected an active video task');
  vi.advanceTimersByTime(2500); await active.completion;
  expect(f.store.jobs.get(String(result.jobId))).toMatchObject({ status: 'succeeded', model: 'grok-imagine-video' });
  const node = f.store.getNode(f.canvas.id, f.video.id);
  expect(node.runState).toBe('done');
  expect(await readFile(path.join(f.dir, 'canvas', node.output.assets[0]), 'utf8')).toBe('fixture video');
  expect(transport.mock.calls.map(call => call[0])).toEqual(['https://gateway.example/v1/videos', 'https://gateway.example/v1/videos/video_fixture', 'https://gateway.example/v1/videos/video_fixture/content']);
  for (const [, init] of transport.mock.calls) expect(init.headers.Authorization).toBe('Bearer fixture-only');
});
