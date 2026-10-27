import { Hono } from 'hono';
import { KnowledgeError, type KnowledgeStore } from '../storage/knowledgeStore';

/** The user's knowledge base: list, add (text already extracted by the client) and remove documents, and try a search. */
export function createKnowledgeRouter(store: KnowledgeStore) {
  const router = new Hono();
  router.get('/', async (c) => c.json({ documents: await store.list() }));
  router.post('/', async (c) => {
    const body = (await c.req.json().catch((): null => null)) as { name?: unknown; text?: unknown } | null;
    if (typeof body?.name !== 'string' || typeof body.text !== 'string') return c.json({ error: '需要 name 和 text' }, 400);
    try { return c.json({ document: await store.add({ name: body.name, text: body.text }) }); }
    catch (error) {
      if (error instanceof KnowledgeError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });
  router.delete('/:id', async (c) => ((await store.remove(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: '没有这份资料' }, 404)));
  router.get('/search', async (c) => c.json({ hits: await store.search(c.req.query('q') ?? '', 8) }));
  return router;
}
