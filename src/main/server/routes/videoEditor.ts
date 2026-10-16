import { Hono } from 'hono';
import type { SessionStore } from '../../../shared/chat';
import { videoEditorFor } from '../videoEditor/service';
import type { CanvasStore } from '../storage/canvasStore';
import { editorMediaFor, EDITOR_MEDIA_MAX_BYTES } from '../videoEditor/mediaExchange';
import { z } from 'zod';
import type { ArtifactStore } from '../storage/artifactStore';
import { editorActivitySchema, editorContextSchema } from '../../../shared/videoEditorContext';
import { editorObservationsFor } from '../videoEditor/observations';
import { createHash } from 'node:crypto';
import { CompositionPreviews } from '../videoEditor/composition';
import { videoExportTasksFor } from '../videoEditor/exportTaskService';
import { bodyLimit } from 'hono/body-limit';
import { videoApprovalFor } from '../videoEditor/approval';

export function createVideoEditorRouter(dataRoot: string, sessions: SessionStore, store: CanvasStore, artifacts?: ArtifactStore) {
  const router = new Hono();
  const media = editorMediaFor(dataRoot, store);
  const observations = editorObservationsFor(dataRoot);
  const previews = new CompositionPreviews(dataRoot);
  const exports = videoExportTasksFor(dataRoot, store);
  async function workspaceFor(sessionId: string) {
    const session = await sessions.get(sessionId);
    if (!session) throw new Error('对话不存在');
    return videoEditorFor(dataRoot).open(sessionId, session.title);
  }
  router.use('/:sessionId/*', async (c, next) => {
    if (!await sessions.get(c.req.param('sessionId'))) return c.json({ error: '对话不存在' }, 404);
    await next();
  });
  router.onError((error, c) => c.json({ error: error.message }, 400));
  router.get('/:sessionId/approval', async (c) => c.json({ mode: await videoApprovalFor(dataRoot).read(c.req.param('sessionId')) }));
  router.put('/:sessionId/approval', async (c) => {
    const { mode } = z.object({ mode: z.enum(['manual', 'auto']) }).strict().parse(await c.req.json());
    await videoApprovalFor(dataRoot).set(c.req.param('sessionId'), mode);
    return c.json({ mode });
  });
  router.get('/:sessionId/context', async (c) => c.json({ ...observations.read(c.req.param('sessionId')), composition: await previews.latest(c.req.param('sessionId')), exports: await exports.list(c.req.param('sessionId')) }));
  router.post('/:sessionId/render-jobs', bodyLimit({ maxSize: 32 * 1024 * 1024 }), async (c) => {
    const input = z.object({ projectId: z.string(), body: z.record(z.string(), z.unknown()) }).parse(await c.req.json());
    const sessionId = c.req.param('sessionId');
    if (input.projectId !== (await workspaceFor(sessionId)).projectId) return c.json({ error: '导出工程不匹配' }, 403);
    const task = await exports.create(sessionId, input.projectId, input.body);
    return c.json({ renderId: task.id, task });
  });
  router.get('/:sessionId/render-jobs/:id', async (c) => c.json(await exports.snapshot(c.req.param('sessionId'), c.req.param('id'))));
  router.delete('/:sessionId/render-jobs/:id', async (c) => c.json(await exports.cancel(c.req.param('sessionId'), c.req.param('id'))));
  router.post('/:sessionId/render-jobs/:id/retry', async (c) => c.json(await exports.retry(c.req.param('sessionId'), c.req.param('id'))));
  router.get('/:sessionId/previews/:id/:index', async (c) => {
    const image = await previews.image(c.req.param('sessionId'), c.req.param('id'), Number(c.req.param('index')));
    return new Response(new Uint8Array(Buffer.from(image.data, 'base64')), { headers: { 'Content-Type': image.mimeType, 'Cache-Control': 'no-store' } });
  });
  router.post('/:sessionId/context', async (c) => {
    const { context, activities } = z.object({ context: editorContextSchema, activities: z.array(editorActivitySchema.refine((event) => !['saved', 'working', 'tool_returned'].includes(event.state), '此状态只能由工作台记录')).max(30) }).parse(await c.req.json());
    const sessionId = c.req.param('sessionId');
    if (context.projectId !== (await workspaceFor(sessionId)).projectId) return c.json({ error: '剪辑工程不匹配' }, 403);
    observations.update(sessionId, context, activities);
    return c.json({ ok: true });
  });
  router.post('/:sessionId/media/artifact', async (c) => {
    const { artifactId, version } = z.object({ artifactId: z.string().min(1).max(200), version: z.number().int().positive() }).parse(await c.req.json());
    const sessionId = c.req.param('sessionId');
    const artifact = artifacts?.getMeta(artifactId);
    if (!artifacts || !artifact || artifact.sessionId !== sessionId) return c.json({ error: '作品不属于当前对话' }, 403);
    if (!['image', 'video', 'audio'].includes(artifact.kind) || artifact.status !== 'complete') return c.json({ error: '请选择已完成的图片、视频或音频' }, 400);
    const selected = artifacts.listVersions(artifactId).find((item) => item.n === version);
    if (!selected) return c.json({ error: '所选版本不存在' }, 404);
    if (selected.byteSize > EDITOR_MEDIA_MAX_BYTES) return c.json({ error: '素材超过 256 MB' }, 413);
    const bytes = await artifacts.readBlob(artifactId, version);
    if (createHash('sha256').update(bytes).digest('hex') !== selected.contentDigest) return c.json({ error: '作品文件与所选版本不符' }, 409);
    const workspace = await workspaceFor(sessionId);
    return c.json({ asset: await media.saveExport(sessionId, workspace.projectId, artifact.name, bytes, 'source') });
  });
  router.get('/:sessionId/media', (c) => c.json({ assets: media.list(c.req.param('sessionId')) }));
  router.post('/:sessionId/media/import', async (c) => {
    const { assetId } = z.object({ assetId: z.string().min(1).max(100) }).parse(await c.req.json());
    const sessionId = c.req.param('sessionId');
    const workspace = await workspaceFor(sessionId);
    return c.json(await media.import(sessionId, workspace.projectId, assetId));
  });
  router.get('/:sessionId/media/jobs', async (c) => {
    const sessionId = c.req.param('sessionId');
    const workspace = await workspaceFor(sessionId);
    return c.json({ jobs: media.jobs(sessionId, workspace.projectId) });
  });
  router.get('/:sessionId/media/jobs/:jobId/file', (c) => {
    const bytes = media.file(c.req.param('sessionId'), c.req.param('jobId'));
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
  });
  router.post('/:sessionId/media/jobs/:jobId', async (c) => {
    const result = z.object({ error: z.string().max(1000).optional(), asset: z.object({ sourceAssetId: z.string().max(100),
      editorAssetId: z.string().min(1).max(200), name: z.string().max(300), durationInFrames: z.number().nonnegative().optional() }).optional() }).parse(await c.req.json());
    media.complete(c.req.param('sessionId'), c.req.param('jobId'), result);
    return c.json({ ok: true });
  });
  router.post('/:sessionId/media/exports', async (c) => {
    const sessionId = c.req.param('sessionId');
    const workspace = await workspaceFor(sessionId);
    if (c.req.query('projectId') !== workspace.projectId) return c.json({ error: '成片不属于当前剪辑工程' }, 403);
    const name = c.req.query('name');
    if (!name || name.length > 200) return c.json({ error: '成片名称无效' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ error: '成片为空' }, 400);
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > EDITOR_MEDIA_MAX_BYTES) { await reader.cancel(); return c.json({ error: '成片超过 256 MB' }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const purpose = z.enum(['export', 'source']).parse(c.req.query('purpose') ?? 'export');
    try {
      const asset = await media.saveExport(sessionId, workspace.projectId, name, Buffer.concat(chunks), purpose);
      observations.record(sessionId, 'saved', `${purpose === 'source' ? '素材' : '成片'}已保存到工作台：${asset.name}`);
      return c.json({ asset });
    } catch (error) {
      observations.record(sessionId, 'failed', `保存失败：${error instanceof Error ? error.message : '未知错误'}`);
      throw error;
    }
  });
  router.post('/:sessionId/open', async (c) => {
    const session = await sessions.get(c.req.param('sessionId'));
    if (!session) return c.json({ error: '对话不存在' }, 404);
    const body = await c.req.json().catch(() => ({}));
    try {
      const editor = videoEditorFor(dataRoot);
      return c.json(await (body?.reconnect === true ? editor.reconnect(session.id, session.title) : editor.open(session.id, session.title)));
    }
    catch (e) { return c.json({ error: e instanceof Error ? e.message : '剪辑工程打开失败' }, 503); }
  });
  return router;
}
