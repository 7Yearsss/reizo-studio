import { Hono } from 'hono';
import { isComputerUseSupported } from '../../computerUse';
import { readScreenshot } from '../../computerUse/store';
import type { SettingsStore } from '../storage/settingsStore';

/**
 * Serves computer-use screenshots to the renderer and a small capability probe.
 * Screenshots only ever leave the machine through this loopback, origin-guarded
 * route.
 */
export function createComputerUseRouter(dataRoot: string, settingsStore: SettingsStore) {
  const router = new Hono();

  router.get('/status', async (c) => {
    const settings = await settingsStore.get();
    return c.json({
      supported: isComputerUseSupported(),
      enabled: settings.computerUse === true,
      platform: process.platform,
    });
  });

  router.get('/:sessionId/:file', async (c) => {
    const rel = `${c.req.param('sessionId')}/${c.req.param('file')}`;
    try {
      const bytes = await readScreenshot(dataRoot, rel);
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000' },
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  return router;
}
