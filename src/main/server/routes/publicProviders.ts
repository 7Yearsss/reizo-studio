import { Hono } from 'hono';
import type { ProviderStore } from '../storage/providerStore';
import type { ProviderCategory } from '../../../shared/providerRegistry';

export function createPublicProvidersRouter(providerStore: ProviderStore) {
  const router = new Hono();

  // Public catalog query endpoint for end users / canvas
  router.get('/catalog', async (c) => {
    const category = c.req.query('category') as ProviderCategory | undefined;
    const catalog = await providerStore.getPublicCatalog(category);
    return c.json(catalog);
  });

  router.get('/catalog/:id', async (c) => {
    const id = c.req.param('id');
    const catalog = await providerStore.getPublicCatalog();
    const item = catalog.providers.find((p) => p.id === id);
    if (!item) {
      return c.json({ error: 'Provider not found' }, 404);
    }
    return c.json({ provider: item });
  });

  return router;
}
