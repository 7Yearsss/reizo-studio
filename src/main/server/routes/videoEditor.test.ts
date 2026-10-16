import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { stopEditorMedia } from '../videoEditor/mediaExchange';
import { createVideoEditorRouter } from './videoEditor';
import { createArtifactStore } from '../storage/artifactStore';
import { createHash, randomUUID } from 'node:crypto';
import type { EditorContext } from '../../../shared/videoEditorContext';
import { CompositionPreviews } from '../videoEditor/composition';
import { videoExportTasksFor, stopVideoExportTasks } from '../videoEditor/exportTaskService';

vi.mock('../videoEditor/service', () => ({ videoEditorFor: () => ({
  open: async (sessionId: string) => ({ projectId: `project-${sessionId}`, name: 'test', url: 'http://127.0.0.1:1/' }),
  renderRequest: async (method: string, id?: string, body?: Record<string, unknown>) => method === 'POST' ? Response.json({ renderId: body?.operationId }) : method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id, status: 'running', progress: 25 }),
}) }));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'reizo-editor-router-'));
  const db = openDb(':memory:'); const sessions = createSqliteSessionStore(db);
  const session = await sessions.create('bridge test', null, null); const store = createCanvasStore(db);
  const artifacts = createArtifactStore(db, root);
  const app = new Hono().route('/video-editor', createVideoEditorRouter(root, sessions, store, artifacts));
  cleanup.push(async () => { const tasks = videoExportTasksFor(root, store); stopVideoExportTasks(root); await tasks.settled(); stopEditorMedia(root); db.close(); await rm(root, { recursive: true, force: true }); });
  return { app, session, store, artifacts, sessions, root };
}
it('persists per-conversation approval preferences without touching pending drafts', async () => {
  const { app, session, sessions } = await fixture();
  const other = await sessions.create('manual default', null, null);
  const route = `/video-editor/${session.id}/approval`;
  expect(await (await app.request(route)).json()).toEqual({ mode: 'manual' });
  const put = (body: unknown) => app.request(route, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect((await put({ mode: 'auto' })).status).toBe(200);
  expect(await (await app.request(route)).json()).toEqual({ mode: 'auto' });
  expect(await (await app.request(`/video-editor/${other.id}/approval`)).json()).toEqual({ mode: 'manual' });
  expect((await put({ mode: 'yolo' })).status).toBe(400);
  expect((await app.request('/video-editor/missing/approval')).status).toBe(404);
});
it('exposes durable exports only to the owning session and validates project and operation identity', async () => {
  const { app, session, sessions } = await fixture(); const other = await sessions.create('other', null, null);
  const url = `/video-editor/${session.id}/render-jobs`;
  const post = (projectId: string, operationId: string) => app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, body: { operationId, format: 'video', codec: 'h264', state: { items: [] } } }) });
  expect((await post('wrong', randomUUID())).status).toBe(403);
  expect((await post(`project-${session.id}`, '../invalid')).status).toBe(400);
  const id = randomUUID(); const response = await post(`project-${session.id}`, id);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ renderId: id });
  for (const method of ['GET', 'DELETE']) expect((await app.request(`/video-editor/${other.id}/render-jobs/${id}`, { method })).status).toBe(400);
  expect((await app.request(`/video-editor/${other.id}/render-jobs/${id}/retry`, { method: 'POST' })).status).toBe(400);
  expect(await (await app.request(`/video-editor/${session.id}/context`)).json()).toMatchObject({ exports: [{ id, projectId: `project-${session.id}` }] });
  expect((await app.request(`${url}/${id}`, { method: 'DELETE' })).status).toBe(200);
});
it('serves durable draft previews only through their owning conversation and current preview identity', async () => {
  const { root, app, session, sessions } = await fixture();
  const other = await sessions.create('other preview', null, null);
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const store = new CompositionPreviews(root);
  const preview = await store.save(session.id, { editSessionId: 'draft', timelineId: 'timeline', summary: '已生成草稿', frames: [0], plan: { name: '试剪', aspectRatio: '9:16', fit: 'contain', durationSeconds: 1, shots: [{ assetId: 'immutable', sourceStartSeconds: 0, durationSeconds: 1, volume: 1 }], title: null, captions: [], captionSource: 'none', music: null } }, { content: [{ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }] });
  const context = await (await app.request(`/video-editor/${session.id}/context`)).json();
  expect(context).toMatchObject({ connected: false, composition: { id: preview.id, editSessionId: 'draft' } });
  const url = (id: string) => `/video-editor/${id}/previews/${preview.id}/0`;
  const image = await app.request(url(session.id));
  expect(image.headers.get('Content-Type')).toBe('image/png');
  expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
  expect((await app.request(url(other.id))).status).toBe(400);
  expect((await app.request(url('missing'))).status).toBe(404);
});
it('denies missing conversations and mismatched export projects before publishing files', async () => {
  const { app, session, store } = await fixture();
  expect((await app.request('/video-editor/missing/media')).status).toBe(404);
  const response = await app.request(`/video-editor/${session.id}/media/exports?projectId=other&name=x.mp4`, { method: 'POST', body: 'file' });
  expect(response.status).toBe(403); expect(store.findCanvasBySession(session.id)).toBeNull();
});

it('validates UI context shape and project ownership, and never accepts a forged saved event', async () => {
  const { app, session } = await fixture();
  const url = `/video-editor/${session.id}/context`;
  const context: EditorContext = { projectId: 'wrong', timeline: { id: 't', name: '主序列', fps: 30, width: 1280, height: 720, itemCount: 1 }, playheadFrame: 10, selectedMedia: [], selectedClips: [], awaiting: 'review', exporting: false };
  const post = (body: unknown) => app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post({ context, activities: [] })).status).toBe(403);
  context.projectId = `project-${session.id}`;
  expect((await post({ context, activities: [] })).status).toBe(200);
  expect(await (await app.request(url)).json()).toMatchObject({ connected: true, context: { awaiting: 'review', playheadFrame: 10 } });
  expect((await post({ context: { ...context, playheadFrame: -1 }, activities: [] })).status).toBe(400);
  expect((await post({ context, activities: [{ id: 'fake', at: Date.now(), state: 'saved', message: '已入库' }] })).status).toBe(400);
});

it('prepares the explicitly selected artifact version, not the newest, and refuses cross-session access', async () => {
  const { app, session, artifacts, sessions } = await fixture();
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('version-one')]);
  const artifact = await artifacts.create({ sessionId: session.id, name: 'picture.png', bytes: png, source: 'generated', kind: 'image' });
  await artifacts.addVersion(artifact.id, { bytes: Buffer.concat([png, Buffer.from('new-version')]), origin: { surface: 'chat' } });
  const route = (id: string, version: number) => app.request(`/video-editor/${id}/media/artifact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: artifact.id, version }) });
  const first = await route(session.id, 1); expect(first.status).toBe(200);
  const result = await first.json();
  expect(result.asset.contentHash).toBe(createHash('sha256').update(png).digest('hex'));
  expect((await (await route(session.id, 1)).json()).asset.id).toBe(result.asset.id);
  expect((await route(session.id, 99)).status).toBe(404);
  const other = await sessions.create('other', null, null);
  expect((await route(other.id, 1)).status).toBe(403);
});
it('returns saved asset identity for retries and refuses invalid media', async () => {
  const { app, session, store } = await fixture();
  const route = `/video-editor/${session.id}/media/exports?projectId=project-${session.id}&name=video.mp4`;
  const invalid = await app.request(route, { method: 'POST', body: 'not a video' });
  expect(invalid.status).toBe(400);
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(30)]);
  const a = await app.request(route, { method: 'POST', body: bytes });
  const b = await app.request(route, { method: 'POST', body: bytes });
  expect(a.status).toBe(200); expect(b.status).toBe(200);
  const first = await a.json(); const second = await b.json();
  expect(first.asset.id).toBe(second.asset.id);
  expect(store.getNodes(first.asset.canvasId)).toHaveLength(1);
  const listing = await (await app.request(`/video-editor/${session.id}/media`)).json();
  expect(listing.assets[0].id).toBe(first.asset.id);
});
