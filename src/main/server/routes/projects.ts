import { Hono } from 'hono';
import type { ProjectStore } from '../storage/projectStore';
import type { SessionStore } from '../storage/ports';

export function createProjectsRouter(projectStore: ProjectStore, sessionStore: SessionStore) {
  const router = new Hono();

  router.get('/', async (c) => {
    const projects = await projectStore.list();
    return c.json({ projects });
  });

  router.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    const project = await projectStore.create({
      name,
      description: typeof body?.description === 'string' ? body.description : undefined,
      instructions: typeof body?.instructions === 'string' ? body.instructions : undefined,
    });
    return c.json({ project }, 201);
  });

  router.get('/:id', async (c) => {
    const project = await projectStore.get(c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json({ project });
  });

  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const project = await projectStore.update(c.req.param('id'), {
        name: typeof body?.name === 'string' ? body.name : undefined,
        description: body?.description === null || typeof body?.description === 'string' ? body.description : undefined,
        instructions:
          body?.instructions === null || typeof body?.instructions === 'string' ? body.instructions : undefined,
      });
      return c.json({ project });
    } catch {
      return c.json({ error: 'Project not found' }, 404);
    }
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const project = await projectStore.get(id);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const sessions = await sessionStore.list();
    await Promise.all(
      sessions.filter((s) => s.projectId === id).map((s) => sessionStore.update(s.id, { projectId: null })),
    );
    await projectStore.remove(id);
    return c.body(null, 204);
  });

  return router;
}
