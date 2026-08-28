import { Hono } from 'hono';
import type { ArtifactStore } from '../storage/artifactStore';
import type { SessionStore } from '../../../shared/chat';

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
    const artifact = await artifactStore.create({
      sessionId: session.id,
      projectId: session.projectId,
      name,
      content,
      source: body?.source === 'generated' ? 'generated' : 'attachment',
      mimeType: typeof body?.mimeType === 'string' ? body.mimeType : undefined,
    });
    return c.json({ artifact }, 201);
  });

  return router;
}

export function createArtifactsRouter(artifactStore: ArtifactStore) {
  const router = new Hono();

  router.get('/:id', async (c) => {
    const artifact = await artifactStore.get(c.req.param('id'));
    if (!artifact) return c.json({ error: 'Artifact not found' }, 404);
    return c.json({ artifact });
  });

  router.delete('/:id', async (c) => {
    const artifact = await artifactStore.get(c.req.param('id'));
    if (!artifact) return c.json({ error: 'Artifact not found' }, 404);
    await artifactStore.remove(artifact.id);
    return c.body(null, 204);
  });

  return router;
}
