import { Hono } from 'hono';
import { z } from 'zod';
import type { DbHandle } from '../db/client';
import { CanvasMaintenanceError, createCanvasMaintenance } from '../storage/canvasMaintenance';

export function createCanvasMaintenanceRouter(handle: DbHandle, dataRoot: string) {
  const router = new Hono();
  const maintenance = createCanvasMaintenance(handle, dataRoot);
  const paths = z.array(z.string().min(1).max(512)).min(1).max(100);
  router.onError((error, c) => {
    if (error instanceof CanvasMaintenanceError) return c.json({ error: error.message }, error.status);
    return c.json({ error: '维护文件状态已变化或不可读取，请刷新后复核' }, 409);
  });
  router.get('/scan', (c) => c.json(maintenance.scan()));
  router.get('/quarantine', (c) => c.json({ batches: maintenance.list() }));
  router.post('/quarantine', async (c) => {
    const input = z.object({ token: z.string().min(1).max(128), paths }).strict().safeParse(await c.req.json().catch((): null => null));
    const operationId = c.req.header('Idempotency-Key');
    if (!input.success || !operationId) return c.json({ error: '需要扫描 token、明确选择的 paths 与 Idempotency-Key' }, 400);
    return c.json(await maintenance.quarantine(input.data.token, input.data.paths, operationId));
  });
  router.post('/quarantine/:batchId/restore', async (c) => {
    const input = z.object({ paths }).strict().safeParse(await c.req.json().catch((): null => null));
    if (!input.success) return c.json({ error: '需要明确选择的恢复 paths' }, 400);
    return c.json(await maintenance.restore(c.req.param('batchId'), input.data.paths));
  });
  return router;
}
