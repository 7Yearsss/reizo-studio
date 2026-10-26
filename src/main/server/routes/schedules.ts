import { Hono } from 'hono';
import { SCHEDULE_PRESETS, isValidCadence } from '../../../shared/schedule';
import { ScheduleValidationError, validateScheduleInterval, type ScheduleStore } from '../storage/scheduleStore';
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
    const intervalMs: unknown = body.intervalMs === undefined ? 60 * 60 * 1000 : body.intervalMs;
    try { validateScheduleInterval(intervalMs); }
    catch (error) { if (error instanceof ScheduleValidationError) return c.json({ error: error.message }, 400); throw error; }
    if (body.cadence !== undefined && !isValidCadence(body.cadence)) return c.json({ error: '运行时间无效' }, 400);
    let schedule;
    try { schedule = await scheduleStore.create({
      name: typeof body.name === 'string' ? body.name : body.prompt.slice(0, 40),
      prompt: body.prompt.trim(),
      intervalMs,
      skillId: typeof body.skillId === 'string' ? body.skillId : undefined,
      once: body.once === true,
      cadence: body.cadence,
      operationId: body.operationId,
    }); } catch (error) { if (error instanceof ScheduleValidationError) return c.json({ error: error.message }, error.status); throw error; }
    return c.json({ schedule }, 201);
  });

  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch((): null => null);
    let schedule;
    try { schedule = await scheduleStore.update(c.req.param('id'), body ?? {}); }
    catch (error) { if (error instanceof ScheduleValidationError) return c.json({ error: error.message }, error.status); throw error; }
    if (!schedule) return c.json({ error: 'Not found' }, 404);
    return c.json({ schedule });
  });

  router.delete('/:id', async (c) => {
    try { await scheduleStore.remove(c.req.param('id')); }
    catch (error) { if (error instanceof ScheduleValidationError) return c.json({ error: error.message }, error.status); throw error; }
    return c.body(null, 204);
  });

  router.post('/:id/run', async (c) => {
    const body = await c.req.json().catch((): null => null);
    try {
      const schedule = await scheduleStore.requestRun(c.req.param('id'), body?.operationId);
      return schedule ? c.json({ schedule }) : c.json({ error: 'Not found' }, 404);
    } catch (error) { if (error instanceof ScheduleValidationError) return c.json({ error: error.message }, error.status); throw error; }
  });

  return router;
}
