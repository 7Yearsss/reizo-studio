import { Hono } from 'hono';
import { statfs } from 'node:fs/promises';

/** Free space on the drive that holds the app's data. Read-only; nothing here touches the data itself. */
export function createStorageRouter(dataRoot: string) {
  const router = new Hono();
  router.get('/disk', async (c) => {
    try {
      const stats = await statfs(dataRoot);
      return c.json({ freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) });
    } catch {
      return c.json({ freeBytes: null, totalBytes: null });
    }
  });
  return router;
}
