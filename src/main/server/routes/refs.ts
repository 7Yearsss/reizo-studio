import { Hono } from 'hono';
import type { LargeValueStore } from '../storage/largeValueStore';

/**
 * Data-plane endpoint for spilled large values (huge tool outputs). Behind
 * the same origin guard as everything else. Returns plain text.
 */
export function createRefsRouter(store: LargeValueStore) {
  const router = new Hono();

  router.get('/:id', (c) => {
    const result = store.read(c.req.param('id'));
    if (result.status === 'expired') return c.json({ error: 'Expired' }, 410);
    if (result.status !== 'ok') return c.json({ error: 'Not found' }, 404);
    return c.body(result.content, 200, { 'content-type': 'text/plain; charset=utf-8' });
  });

  return router;
}
