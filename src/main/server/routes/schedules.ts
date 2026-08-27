import { Hono } from 'hono';
import { SCHEDULE_PRESETS } from '../../../shared/schedule';
import type { ScheduleStore } from '../storage/scheduleStore';
import type { ThoughtStore } from '../storage/thoughtStore';

export function createSchedulesRouter(scheduleStore: ScheduleStore, thoughtStore: ThoughtStore) {
  const router = new Hono();

  router.get('/thoughts', async (c) => c.json({ thoughts: await thoughtStore.list() }));

  router.post('/thoughts', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.content !== 'string' || !body.content.trim()) {
      return c.json({ error: 'content is required' }, 400);
    }
    const thought = await thoughtStore.create(body.content, Array.isArray(body.tags) ? body.tags : []);
    return c.json({ thought }, 201);
  });

  router.delete('/thoughts/:id', async (c) => {
    await thoughtStore.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  router.get('/', async (c) => c.json({ schedules: await scheduleStore.list(), presets: SCHEDULE_PRESETS }));

  router.post('/', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.prompt !== 'string' || !body.prompt.trim()) {
      return c.json({ error: 'prompt is required' }, 400);
    }
    const intervalMs = typeof body.intervalMs === 'number' ? body.intervalMs : 60 * 60 * 1000;
    const schedule = await scheduleStore.create({
      name: typeof body.name === 'string' ? body.name : body.prompt.slice(0, 40),
      prompt: body.prompt.trim(),
      intervalMs,
      skillId: typeof body.skillId === 'string' ? body.skillId : undefined,
    });
    return c.json({ schedule }, 201);
  });

  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch((): null => null);
    const schedule = await scheduleStore.update(c.req.param('id'), body ?? {});
    if (!schedule) return c.json({ error: 'Not found' }, 404);
    return c.json({ schedule });
  });

  router.delete('/:id', async (c) => {
    await scheduleStore.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  return router;
}
