import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ArtifactKind, ArtifactSource } from '../../../shared/artifact';
import type { SessionStore } from '../../../shared/chat';

const KINDS: ArtifactKind[] = [
  'markdown', 'html', 'text', 'json', 'image', 'binary',
  'svg', 'diagram', 'code', 'video', 'audio', 'sketch',
];

export function createSessionArtifactsRouter(artifactStore: ArtifactStore, sessionStore: SessionStore) {
  const router = new Hono();

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
      return c.body(full.content, 200, { 'Content-Type': meta.mimeType });
    }
    try {
      const bytes = await readFile(file);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'content-type': meta.mimeType,
          'cache-control': 'private, max-age=31536000, immutable',
        },
      });
    } catch {
      return c.json({ error: 'Blob missing' }, 404);
    }
  });

  router.post('/:id/versions', async (c) => {
    const id = c.req.param('id');
    if (!artifactStore.getMeta(id)) return c.json({ error: 'Artifact not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const content = typeof body?.content === 'string' ? body.content : '';
    const updated = await artifactStore.addVersion(id, {
      content,
      origin: { surface: 'manual_edit' },
      label: 'Manual edit',
    });
    if (!updated) return c.json({ error: 'Artifact not found' }, 404);
    return c.json({ artifact: updated });
  });

  router.post('/:id/restore/:n', async (c) => {
    const id = c.req.param('id');
    const n = Number(c.req.param('n'));
    if (!Number.isFinite(n)) return c.json({ error: 'bad version' }, 400);
    const updated = await artifactStore.restoreVersion(id, n);
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
