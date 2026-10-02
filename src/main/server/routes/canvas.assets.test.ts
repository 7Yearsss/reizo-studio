import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { openDb } from '../db/client';
import { createCanvasStore } from '../storage/canvasStore';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createArtifactStore } from '../storage/artifactStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createCanvasRouter } from './canvas';
import { getCanvasChannel } from '../canvas/channel';
import { stopCanvasWork } from '../canvas/workLifecycle';
import { createCanvasTools } from '../agent/canvasTools';
import { runGraph } from '../canvas/graphExecutor';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateImage: generate }));
vi.mock('../agent/provider/openai', () => ({ createOpenAiProvider: () => ({ image: (id: string) => ({ id }) }) }));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const settings = { get: async () => ({ activeProviderId: 'openai', providers: { openai: { apiKey: 'fixture-only-key', baseUrl: 'https://fixture.invalid/v1' } } }) } as unknown as SettingsStore;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); generate.mockReset(); for (const fn of cleanup.splice(0)) await fn(); });

async function fixture() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('asset-history', null, null);
  const store = createCanvasStore(handle);
  const canvasId = store.ensureCanvas(session.id).id;
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-asset-http-'));
  const artifacts = createArtifactStore(handle, dataRoot);
  const app = new Hono().route('/api/canvas', createCanvasRouter(store, settings, sessions, dataRoot, artifacts));
  cleanup.push(async () => {
    stopCanvasWork(store); handle.close();
    if (path.dirname(path.resolve(dataRoot)) === path.resolve(os.tmpdir())) await rm(dataRoot, { recursive: true, force: true });
  });
  const post = (url: string, body: unknown, operationId?: string) => app.request(url, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(operationId ? { 'Idempotency-Key': operationId } : {}) }, body: JSON.stringify(body) });
  return { handle, sessions, session, store, canvasId, dataRoot, artifacts, app, post };
}

describe('canvas asset publication', () => {
  it('reuses exact versions across canvases without generation and keeps fixed targets isolated from the original producer', async () => {
    const f = await fixture();
    const image = { images: [{ uint8Array: new Uint8Array(PNG), mediaType: 'image/png' }] };
    generate.mockResolvedValue(image);
    const source = f.store.addNode(f.canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'original material', size: '1024x1024' } }).node;
    const accepted = await (await f.post(`/api/canvas/${f.canvasId}/nodes/${source.id}/run`, { confirmedSpend: true }, 'source-version')).json();
    await vi.waitFor(() => expect(f.store.jobs.get(accepted.jobId)?.status).toBe('succeeded'));
    const version = f.store.getNode(f.canvasId, source.id).output.resultSet[0];
    const destination = await f.sessions.create('reuse-target', null, null);
    const canvasId = f.store.ensureCanvas(destination.id).id;
    const request = { assetId: version.assetId, asReference: true };
    const reply = await f.post(`/api/canvas/${canvasId}/assets/reuse`, request, 'fixed-intent');
    expect(reply.status).toBe(201);
    const fixed = await reply.json();
    expect(fixed.node).toMatchObject({ type: 'anchor', params: { assetId: version.assetId }, output: { assets: [version.asset] } });
    expect(f.store.getEdges(canvasId)).toEqual([]);
    await f.sessions.remove(f.session.id);
    const repeated = await (await f.post(`/api/canvas/${canvasId}/assets/reuse`, request, 'fixed-intent')).json();
    expect(repeated.node.id).toBe(fixed.node.id);
    const { tools } = createCanvasTools({ sessionId: destination.id, canvasStore: f.store, settingsStore: settings, dataRoot: f.dataRoot });
    const replayed = await tools.reuse_asset.execute(request, { toolCallId: 'fixed-intent', messages: [], context: undefined });
    expect(replayed).toMatchObject({ id: fixed.node.id });
    const library = await (await f.app.request('/api/canvas/assets/library?kind=image')).json();
    expect(library.assets[0]).toMatchObject({ id: version.assetId });
    expect(library.assets[0]).not.toHaveProperty('inputHash');
    expect(f.store.getSnapshot(canvasId).nodes).toHaveLength(1);
    expect(generate).toHaveBeenCalledOnce();
    const failed = f.store.addNode(canvasId, { type: 'image', x: 0, y: 100, w: 100, h: 100, params: { prompt: 'fail producer', size: '1024x1024' } }).node;
    const target = f.store.addNode(canvasId, { type: 'image', x: 200, y: 100, w: 100, h: 100, params: { prompt: 'use fixed material', size: '1024x1024' } }).node;
    f.store.addEdge(canvasId, { sourceId: fixed.node.id, targetId: target.id, targetHandle: 'reference' });
    generate.mockImplementation(async ({ prompt }: { prompt: string | { text: string; images: Uint8Array[] } }) => {
      const text = typeof prompt === 'string' ? prompt : prompt.text;
      if (text.includes('fail producer')) throw new Error('deliberate failure');
      expect(typeof prompt === 'string' ? [] : prompt.images).toEqual([new Uint8Array(PNG)]);
      return image;
    });
    await runGraph({ canvasStore: f.store, canvasId, settingsStore: settings, dataRoot: f.dataRoot, nodeIds: [failed.id, target.id] });
    expect(f.store.getNode(canvasId, failed.id)?.runState).toBe('error');
    expect(f.store.getNode(canvasId, target.id)?.runState).toBe('done');
  });

  it('publishes generation provenance with the job and preserves it when copying an edited node to an artifact', async () => {
    const f = await fixture();
    generate.mockResolvedValue({ images: [{ uint8Array: new Uint8Array(PNG), mediaType: 'image/png' }] });
    const node = f.store.addNode(f.canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100,
      params: { prompt: 'original prompt', model: 'actual-image-model', size: '1024x1024' } }).node;
    const accepted = await (await f.post(`/api/canvas/${f.canvasId}/nodes/${node.id}/run`, { confirmedSpend: true }, 'asset-generation')).json();
    await vi.waitFor(() => expect(f.store.jobs.get(accepted.jobId)?.status).toBe('succeeded'));
    const completed = f.store.getNode(f.canvasId, node.id);
    const version = completed.output.resultSet[0];
    const asset = f.store.assets.get(version.assetId);
    expect(asset).toMatchObject({ path: completed.output.assets[0], source: 'generated', jobId: accepted.jobId,
      generation: 1, providerId: 'openai', model: 'actual-image-model', byteSize: PNG.length });
    expect(f.store.jobs.get(accepted.jobId)?.result).toEqual(completed.output);
    const detail = await (await f.app.request(`/api/canvas/${f.canvasId}/assets/${asset.id}`)).json();
    expect(detail.asset).toEqual(asset);
    expect((await f.app.request(`/api/canvas/other/assets/${asset.id}`)).status).toBe(404);
    const raw = await f.app.request(`/api/canvas/assets/${asset.path}`);
    expect(Buffer.from(await raw.arrayBuffer())).toEqual(PNG);
    f.store.updateNode(f.canvasId, node.id, { params: { prompt: 'new prompt', model: 'unused-model', size: '1024x1024' } });
    const copied = await (await f.post(`/api/canvas/${f.canvasId}/nodes/${node.id}/save-asset`, {})).json();
    expect(copied.artifact.origin).toMatchObject({ canvasAssetId: asset.id, jobId: accepted.jobId, generation: 1,
      prompt: 'original prompt', model: 'actual-image-model', contentHash: asset.contentHash });
    f.store.deleteNode(f.canvasId, node.id);
    expect(f.store.assets.get(asset.id)).toEqual(asset);
    expect(await readFile(f.artifacts.blobFilePath(copied.artifact.id, 1))).toEqual(PNG);
  });

  it('rolls failed imports back without removing legacy files and protects committed files before publication observers stop work', async () => {
    const f = await fixture();
    const dir = path.join(f.dataRoot, 'canvas', f.canvasId);
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'legacy.png'), PNG);
    const before = f.store.getSnapshot(f.canvasId);
    f.handle.raw.exec("CREATE TRIGGER fail_import BEFORE UPDATE ON canvas_nodes WHEN NEW.run_state = 'done' BEGIN SELECT RAISE(ABORT, 'import failure'); END");
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const body = { name: 'import.png', dataBase64: PNG.toString('base64') };
    expect((await f.post(`/api/canvas/${f.canvasId}/import`, body)).status).toBe(500);
    expect(f.store.getSnapshot(f.canvasId)).toEqual(before);
    expect(f.store.assets.list(f.canvasId)).toEqual([]);
    expect(await readdir(dir)).toEqual(['legacy.png']);
    f.handle.raw.exec('DROP TRIGGER fail_import');
    const unsubscribe = getCanvasChannel(f.canvasId).subscribe(({ event }) => {
      if (event.type === 'node_updated' && event.node.runState === 'done') stopCanvasWork(f.store);
    });
    try {
      const response = await f.post(`/api/canvas/${f.canvasId}/import`, body, 'committed-import');
      expect(response.status).toBe(201);
      const { node } = await response.json();
      const raw = await f.app.request(`/api/canvas/assets/${node.output.assets[0]}`);
      expect(Buffer.from(await raw.arrayBuffer())).toEqual(PNG);
      expect(f.store.assets.list(f.canvasId)).toHaveLength(1);
      expect((await readdir(dir)).filter((name) => name.endsWith('.part'))).toEqual([]);
    } finally { unsubscribe(); }
  });
});
