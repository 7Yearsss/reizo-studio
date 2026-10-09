import { Hono } from 'hono';
import type { DbHandle } from '../db/client';
import { createUsageStore, UsageStoreError } from '../storage/usageStore';
export function createUsageRouter(handle: DbHandle) {
  const router = new Hono(); const usage = createUsageStore(handle);
  router.onError((error, c) => error instanceof UsageStoreError ? c.json({ error: error.message }, error.status) : c.json({ error: '用量记录暂不可读取' }, 500));
  router.get('/summary', (c) => c.json(usage.summary()));
  router.get('/records', (c) => c.json(usage.list({ jobId: c.req.query('jobId'), limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined, cursor: c.req.query('cursor') })));
  router.get('/pricing', (c) => c.json({ snapshots: usage.prices() }));
  router.post('/pricing', async (c) => c.json(usage.createPrice(await c.req.json().catch((): null => null)), 201));
  router.post('/bills', async (c) => c.json(usage.recordBill(await c.req.json().catch((): null => null)), 201));
  return router;
}
