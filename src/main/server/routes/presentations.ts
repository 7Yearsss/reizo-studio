import { Hono } from 'hono';
import type { ArtifactStore } from '../storage/artifactStore';
import type { SessionStore } from '../../../shared/chat';
import { importPresentationPptx, MAX_PPTX_UPLOAD_BYTES, PPTX_MIME } from '../../../shared/presentationImport';
import { MAX_PRESENTATION_BYTES, normalizePresentation, PRESENTATION_MIME } from '../../../shared/presentationContent';

export function createPresentationsRouter(artifacts: ArtifactStore, sessions: SessionStore) {
  const router = new Hono();
  router.post('/:sessionId/presentations/import', async (c) => {
    const session = await sessions.get(c.req.param('sessionId')); if (!session) return c.json({ error: '会话不存在' }, 404);
    const name = c.req.query('name')?.trim() ?? '';
    const recovery = /\.reizo-ppt\.json$/i.test(name);
    if (!recovery && !/\.pptx$/i.test(name)) return c.json({ error: '请选择 .pptx 或 .reizo-ppt.json 文件' }, 400);
    const limit = recovery ? MAX_PRESENTATION_BYTES : MAX_PPTX_UPLOAD_BYTES;
    if (number(c.req.header('content-length')) > limit) return c.json({ error: '文件超过导入大小上限' }, 413);
    const reader = c.req.raw.body?.getReader(); if (!reader) return c.json({ error: '文件为空' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); return c.json({ error: '文件超过导入大小上限' }, 413); } chunks.push(value); }
    try {
      const bytes = Buffer.concat(chunks);
      const content = recovery ? normalizePresentation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) : await importPresentationPptx(bytes);
      // Recovery files may reference another session's original attachment.
      delete content.originalArtifactId;
      const original = recovery ? null : await artifacts.create({ sessionId: session.id, projectId: session.projectId, name, kind: 'binary', source: 'attachment', bytes, mimeType: PPTX_MIME });
      try {
        const artifact = await artifacts.create({ sessionId: session.id, projectId: session.projectId, name: name.replace(/(?:\.pptx|\.reizo-ppt\.json)$/i, ''), kind: 'presentation', mimeType: PRESENTATION_MIME, source: 'attachment', content: JSON.stringify({ ...content, ...(original ? { originalArtifactId: original.id } : {}) }) });
        return c.json({ artifact }, 201);
      } catch (error) { if (original) await artifacts.remove(original.id); throw error; }
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'PPTX 导入失败' }, 400); }
  });
  return router;
}
function number(value?: string): number { return Number(value) || 0; }
