import { Hono } from 'hono';
import type { SessionStore } from '../storage/ports';

export function createSessionsRouter(sessionStore: SessionStore) {
  const router = new Hono();

  router.get('/', async (c) => {
    const sessions = await sessionStore.list();
    return c.json({ sessions });
  });

  router.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const workspacePath = typeof body?.workspacePath === 'string' ? body.workspacePath : body?.workspacePath === null ? null : undefined;
    const session = await sessionStore.create(body?.title, workspacePath);
    return c.json({ session }, 201);
  });

  router.get('/:id', async (c) => {
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({ session });
  });

  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body?.title !== 'string' || !body.title.trim()) {
      return c.json({ error: 'title is required' }, 400);
    }
    try {
      const session = await sessionStore.rename(c.req.param('id'), body.title);
      return c.json({ session });
    } catch {
      return c.json({ error: 'Session not found' }, 404);
    }
  });

  router.delete('/:id', async (c) => {
    await sessionStore.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  return router;
}
