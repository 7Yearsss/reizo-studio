import { Hono } from 'hono';
import type { ExpertAgent } from '../../../shared/expertAgent';
import { ExpertValidationError, type ExpertStore } from '../storage/expertStore';

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

export function createExpertsRouter(store: ExpertStore) {
  const router = new Hono();

  router.get('/', async (c) => c.json({ experts: await store.list() }));

  router.put('/', async (c) => {
    const body = (await c.req.json().catch((): null => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const input: Omit<ExpertAgent, 'id'> = {
      name: asString(body.name),
      aliases: Array.isArray(body.aliases) ? body.aliases.filter((a): a is string => typeof a === 'string') : [],
      description: asString(body.description),
      instructions: asString(body.instructions),
      providerId: asString(body.providerId) || undefined,
      model: asString(body.model) || undefined,
      allowedTools: asString(body.allowedTools) || undefined,
      maxTurns: typeof body.maxTurns === 'number' ? body.maxTurns : undefined,
    };
    try {
      return c.json({ expert: await store.save(input) });
    } catch (error) {
      if (error instanceof ExpertValidationError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  router.delete('/:id', async (c) => (await store.remove(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404));

  return router;
}
