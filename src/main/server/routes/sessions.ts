import { Hono } from 'hono';
import type { SessionStore } from '../storage/ports';
import type { ArtifactStore } from '../storage/artifactStore';

export function createSessionsRouter(sessionStore: SessionStore, artifactStore?: ArtifactStore) {
  const router = new Hono();

  router.get('/', async (c) => {
    const projectId = c.req.query('projectId');
    let sessions = await sessionStore.list();
    if (projectId) sessions = sessions.filter((s) => s.projectId === projectId);
    return c.json({ sessions });
  });

  router.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const workspacePath =
      typeof body?.workspacePath === 'string' ? body.workspacePath : body?.workspacePath === null ? null : undefined;
    const projectId =
      typeof body?.projectId === 'string' ? body.projectId : body?.projectId === null ? null : undefined;
    const session = await sessionStore.create(body?.title, workspacePath, projectId);
    return c.json({ session }, 201);
  });

  router.get('/:id', async (c) => {
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({ session });
  });

  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const hasTitle = typeof body?.title === 'string' && body.title.trim();
    const hasProject = body?.projectId === null || typeof body?.projectId === 'string';
    if (!hasTitle && !hasProject) {
      return c.json({ error: 'title or projectId is required' }, 400);
    }
    try {
      const session = await sessionStore.update(c.req.param('id'), {
        title: hasTitle ? body.title : undefined,
        projectId: hasProject ? body.projectId : undefined,
      });
      return c.json({ session });
    } catch {
      return c.json({ error: 'Session not found' }, 404);
    }
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (artifactStore) await artifactStore.removeBySession(id);
    await sessionStore.remove(id);
    return c.body(null, 204);
  });

  return router;
}
