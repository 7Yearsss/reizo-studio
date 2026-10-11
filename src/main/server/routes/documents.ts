import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SessionStore } from '../../../shared/chat';
import { createDocumentContent, DOCUMENT_MIME, parseDocumentContent } from '../../../shared/documentContent';
import { specFromContent } from '../../../shared/documentFormat';
import { ArtifactReviewError, type ArtifactReviewStore } from '../storage/artifactReviewStore';
import { ArtifactVersionConflictError, type ArtifactStore } from '../storage/artifactStore';
import { DOCX_MIME, exportDocx, importDocx, MAX_DOCX_UPLOAD_BYTES } from '../agent/documentIO';

/** The request body as a Buffer, or the error response when it is empty or over the upload limit. */
async function readUpload(request: Request): Promise<Buffer | Response> {
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: '文件为空' }, { status: 400 });
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > MAX_DOCX_UPLOAD_BYTES) { await reader.cancel(); return Response.json({ error: '文档超过 8 MB 上限' }, { status: 413 }); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createDocumentsRouter(artifacts: ArtifactStore, sessions: SessionStore, reviews: ArtifactReviewStore) {
  const router = new Hono();
  router.onError((error, c) => {
    if (error instanceof ArtifactVersionConflictError) return c.json({ error: error.message }, 409);
    if (error instanceof ArtifactReviewError) return c.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return c.json({ error: '请求格式无效' }, 400);
    console.error('[documents]', error);
    return c.json({ error: error.message || '文档处理失败' }, 400);
  });
  router.post('/sessions/:sessionId/documents', async (c) => {
    const session = await sessions.get(c.req.param('sessionId'));
    if (!session) return c.json({ error: '会话不存在' }, 404);
    const body = z.object({ name: z.string().trim().min(1).max(200) }).parse(await c.req.json());
    const artifact = await artifacts.create({ sessionId: session.id, projectId: session.projectId, name: body.name, kind: 'doc', mimeType: DOCUMENT_MIME, source: 'manual', content: JSON.stringify(createDocumentContent()), origin: { surface: 'manual_edit' } });
    return c.json({ artifact }, 201);
  });
  // Learn the layout of a reference document (范文) without adding it to the session.
  router.post('/documents/reference-format', async (c) => {
    const name = c.req.query('name')?.trim() ?? '';
    if (!/\.docx$/i.test(name)) return c.json({ error: '请选择 .docx 文档' }, 400);
    if (Number(c.req.header('content-length')) > MAX_DOCX_UPLOAD_BYTES) return c.json({ error: '文档超过 8 MB 上限' }, 413);
    const bytes = await readUpload(c.req.raw);
    if (bytes instanceof Response) return bytes;
    const content = await importDocx(bytes);
    return c.json({ spec: specFromContent(content, `范文：${name.replace(/\.docx$/i, '')}`) });
  });
  router.post('/sessions/:sessionId/documents/import', async (c) => {
    const session = await sessions.get(c.req.param('sessionId'));
    if (!session) return c.json({ error: '会话不存在' }, 404);
    const name = c.req.query('name')?.trim() ?? '';
    if (!/\.docx$/i.test(name)) return c.json({ error: '请选择 .docx 文档' }, 400);
    if (Number(c.req.header('content-length')) > MAX_DOCX_UPLOAD_BYTES) return c.json({ error: '文档超过 8 MB 上限' }, 413);
    const bytes = await readUpload(c.req.raw);
    if (bytes instanceof Response) return bytes;
    const content = await importDocx(bytes);
    const original = await artifacts.create({ sessionId: session.id, projectId: session.projectId, name, bytes, kind: 'binary', mimeType: DOCX_MIME, source: 'attachment' });
    try {
      const artifact = await artifacts.create({ sessionId: session.id, projectId: session.projectId, name: name.replace(/\.docx$/i, ''), kind: 'doc', mimeType: DOCUMENT_MIME, source: 'attachment', content: JSON.stringify({ ...content, originalArtifactId: original.id }) });
      return c.json({ artifact }, 201);
    } catch (error) { await artifacts.remove(original.id); throw error; }
  });
  router.get('/artifacts/:id/document.docx', async (c) => {
    const artifact = await artifacts.get(c.req.param('id'));
    if (!artifact || artifact.kind !== 'doc') return c.json({ error: '文档不存在' }, 404);
    const content = parseDocumentContent(artifact.content);
    if (!content) return c.json({ error: '文档格式无效' }, 400);
    const filename = `${artifact.name.replace(/\.docx$/i, '').replace(/[\r\n/\\]/g, '_')}.docx`;
    let original: Buffer | undefined;
    const originalMeta = content.originalArtifactId ? artifacts.getMeta(content.originalArtifactId) : null;
    const originalPath = originalMeta ? artifacts.blobFilePath(originalMeta.id, originalMeta.version) : null;
    if (originalPath) original = await readFile(originalPath).catch((): undefined => undefined);
    // ?revisions=1: what changed since the imported original is written as Word tracked changes.
    const revisions = c.req.query('revisions') === '1' && original && content.docx ? { author: 'Reizo' } : undefined;
    return new Response(new Uint8Array(await exportDocx(content, original, revisions ? { revisions } : {})), { headers: { 'content-type': DOCX_MIME, 'content-disposition': `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}` } });
  });
  router.get('/artifacts/:id/reviews', async (c) => {
    if (!artifacts.getMeta(c.req.param('id'))) return c.json({ error: '文档不存在' }, 404);
    // Reviews proposed in batches follow the document as earlier batches are accepted.
    await reviews.rebaseStale(c.req.param('id'));
    return c.json({ reviews: reviews.list(c.req.param('id')) });
  });
  router.post('/artifacts/:id/reviews/:reviewId/decide', async (c) => {
    const artifact = artifacts.getMeta(c.req.param('id'));
    const review = reviews.get(c.req.param('reviewId'));
    if (!artifact || !review || review.artifactId !== artifact.id) return c.json({ error: '修改建议不存在' }, 404);
    const body = z.object({ expectedReviewVersion: z.number().int().positive(), changeIds: z.array(z.string()).min(1).max(40), decision: z.enum(['accept', 'reject']) }).parse(await c.req.json());
    const updated = await reviews.decide({ ...body, id: review.id, sessionId: artifact.sessionId });
    return c.json({ review: updated, artifact: await artifacts.get(artifact.id) });
  });
  router.post('/artifacts/:id/reviews/:reviewId/changes/:changeId', async (c) => {
    const artifact = artifacts.getMeta(c.req.param('id')); const review = reviews.get(c.req.param('reviewId'));
    if (!artifact || !review || review.artifactId !== artifact.id) return c.json({ error: '修改建议不存在' }, 404);
    const body = z.object({ expectedReviewVersion: z.number().int().positive(), operation: z.unknown() }).parse(await c.req.json());
    return c.json({ review: await reviews.revise({ ...body, id: review.id, sessionId: artifact.sessionId, changeId: c.req.param('changeId') }) });
  });
  return router;
}
