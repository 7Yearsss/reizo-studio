import { validateHtmlContent } from '../../../shared/htmlContent';
import { normalizePresentation } from '../../../shared/presentationContent';
import { normalizeDocumentContent } from '../../../shared/documentContent';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import type { ArtifactStore } from '../storage/artifactStore';
import { ArtifactVersionConflictError } from '../storage/artifactStore';
import { parseSheetContent, serializeSheetContent, sheetSnapshotLimitsError, SHEET_MIME } from '../../../shared/sheetContent';
import { MAX_SHEET_UPLOAD_BYTES } from '../../../shared/sheetFile';
import { parseXlsxToSheetContent } from '../../../shared/sheetXlsx';
import type { ArtifactKind, ArtifactSource } from '../../../shared/artifact';
import type { SessionStore } from '../../../shared/chat';

const KINDS: ArtifactKind[] = [
  'markdown', 'html', 'text', 'json', 'image', 'binary',
  'svg', 'diagram', 'code', 'video', 'audio', 'sketch', 'sheet', 'presentation',
];

function presentationDisposition(name: string): string {
  const printable = Array.from(Buffer.from(name, 'utf8').toString('utf8')).map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character).join('');
  const clean = printable.replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').trim();
  let stem = [...clean.replace(/(?:\.pptx)+$/i, '').replace(/[. ]+$/g, '')].slice(0, 120).join('') || '演示稿';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  const filename = `${stem}.pptx`;
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_') || 'presentation.pptx';
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function createSessionArtifactsRouter(artifactStore: ArtifactStore, sessionStore: SessionStore) {
  const router = new Hono();

  router.post('/:id/artifacts/sheets/import', async (c) => {
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    const name = c.req.query('name')?.trim() ?? '';
    if (!/\.xlsx$/i.test(name)) return c.json({ error: '请导入 .xlsx 文件；旧版 .xls 和含宏 .xlsm 请先另存为 .xlsx' }, 400);
    if (Number(c.req.header('content-length')) > MAX_SHEET_UPLOAD_BYTES) return c.json({ error: '表格超过 8 MB 上限' }, 413);
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ error: '文件为空' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SHEET_UPLOAD_BYTES) { await reader.cancel(); return c.json({ error: '表格超过 8 MB 上限' }, 413); }
      chunks.push(value);
    }
    const parsed = await parseXlsxToSheetContent(Buffer.concat(chunks), name);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const artifact = await artifactStore.create({ sessionId: session.id, projectId: session.projectId, name, kind: 'sheet', mimeType: SHEET_MIME, source: 'attachment', content: serializeSheetContent(parsed.content), origin: { surface: 'attachment' } });
    return c.json({ artifact }, 201);
  });

  router.get('/:id/artifacts', async (c) => {
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    const artifacts = await artifactStore.listBySession(session.id);
    return c.json({ artifacts });
  });

  router.post('/:id/artifacts', async (c) => {
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const content = typeof body?.content === 'string' ? body.content : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    const source: ArtifactSource =
      body?.source === 'generated' ? 'generated' : body?.source === 'manual' ? 'manual' : 'attachment';
    const kind = KINDS.includes(body?.kind) ? (body.kind as ArtifactKind) : undefined;
    const artifact = await artifactStore.create({
      sessionId: session.id,
      projectId: session.projectId,
      name,
      content,
      source,
      kind,
      mimeType: typeof body?.mimeType === 'string' ? body.mimeType : undefined,
      origin: source === 'manual' ? { surface: 'manual_edit' } : undefined,
    });
    return c.json({ artifact }, 201);
  });

  return router;
}

export function createArtifactsRouter(artifactStore: ArtifactStore) {
  const router = new Hono();

  router.get('/', async (c) => c.json({ artifacts: await artifactStore.listAll() }));

  router.get('/:id', async (c) => {
    const vParam = c.req.query('v');
    const v = vParam ? Number(vParam) : undefined;
    const artifact = await artifactStore.get(c.req.param('id'), Number.isFinite(v) ? v : undefined);
    if (!artifact) return c.json({ error: 'Artifact not found' }, 404);
    return c.json({ artifact });
  });

  router.get('/:id/versions', async (c) => {
    if (!artifactStore.getMeta(c.req.param('id'))) return c.json({ error: 'Artifact not found' }, 404);
    return c.json({ versions: artifactStore.listVersions(c.req.param('id')) });
  });

  router.get('/:id/raw', async (c) => {
    const id = c.req.param('id');
    const meta = artifactStore.getMeta(id);
    if (!meta) return c.json({ error: 'Artifact not found' }, 404);
    const v = Number(c.req.query('v')) || meta.version;
    const file = artifactStore.blobFilePath(id, v);
    if (!file) {
      // Not a blob version — fall back to inline content.
      const full = await artifactStore.get(id, v);
      if (!full) return c.json({ error: 'Version not found' }, 404);
      if (meta.kind === 'html') return c.body(full.content, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="page.html"', 'Content-Security-Policy': "sandbox; default-src 'none'" });
      return c.body(full.content, 200, { 'Content-Type': meta.mimeType });
    }
    try {
      const bytes = meta.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ? await artifactStore.readBlob(id, v) : await readFile(file);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'content-type': meta.mimeType,
          'cache-control': 'private, max-age=31536000, immutable',
          ...(meta.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ? { 'content-disposition': presentationDisposition(meta.name) } : {}),
        },
      });
    } catch {
      return c.json({ error: 'Blob missing' }, 404);
    }
  });

  router.post('/:id/versions', async (c) => {
    const id = c.req.param('id');
    const meta = artifactStore.getMeta(id);
    if (!meta) return c.json({ error: 'Artifact not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    let content = typeof body?.content === 'string' ? body.content : '';
    const expectedVersion = body?.expectedVersion;
    if (meta.kind === 'presentation') {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return c.json({ error: 'PPT 保存需要 expectedVersion' }, 400);
      try { content = JSON.stringify(normalizePresentation(JSON.parse(content))); } catch (error) { return c.json({ error: String(error) }, 400); }
    }
    if (meta.kind === 'html') {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return c.json({ error: 'HTML save requires expectedVersion' }, 400);
      try { validateHtmlContent(content); } catch (error) { return c.json({ error: String(error) }, 400); }
    }
    if (meta.kind === 'doc') {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return c.json({ error: '文档保存需要 expectedVersion' }, 400);
      try { content = JSON.stringify(normalizeDocumentContent(JSON.parse(content))); } catch (error) { return c.json({ error: error instanceof Error ? error.message : '文档格式无效' }, 400); }
    }
    if (meta.kind === 'sheet' && (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !parseSheetContent(content))) return c.json({ error: '表格保存需要有效内容和 expectedVersion' }, 400);
    if (meta.kind === 'sheet') {
      const limitsError = sheetSnapshotLimitsError(parseSheetContent(content)?.univerSnapshot);
      if (limitsError) return c.json({ error: limitsError }, 400);
    }
    try {
    const updated = await artifactStore.addVersion(id, {
      content,
      expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : undefined,
      origin: { surface: 'manual_edit' },
      label: 'Manual edit',
    });
    if (!updated) return c.json({ error: 'Artifact not found' }, 404);
    return c.json({ artifact: updated });
    } catch (error) {
      if (error instanceof ArtifactVersionConflictError) return c.json({ error: error.message }, 409);
      throw error;
    }
  });

  router.post('/:id/restore/:n', async (c) => {
    const id = c.req.param('id');
    const n = Number(c.req.param('n'));
    if (!Number.isFinite(n)) return c.json({ error: 'bad version' }, 400);
    const body = await c.req.json().catch(() => ({}));
    if (body.expectedVersion !== undefined && (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1)) return c.json({ error: 'expectedVersion 无效' }, 400);
    let updated;
    try { updated = await artifactStore.restoreVersion(id, n, body.expectedVersion); }
    catch (error) { if (error instanceof ArtifactVersionConflictError) return c.json({ error: error.message }, 409); throw error; }
    if (!updated) return c.json({ error: 'Artifact or version not found' }, 404);
    return c.json({ artifact: updated });
  });

  router.delete('/:id', async (c) => {
    if (!artifactStore.getMeta(c.req.param('id'))) return c.json({ error: 'Artifact not found' }, 404);
    await artifactStore.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  return router;
}
