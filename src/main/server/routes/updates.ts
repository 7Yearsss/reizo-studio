import { Hono } from 'hono';
import { judgeUpdate, parseUpdateFeed } from '../../../shared/updateCheck';

const MAX_FEED_BYTES = 64 * 1024;

/** `GET /check`: ask the configured feed (a small JSON `{version, url, notes}`) whether a newer version exists. */
export function createUpdatesRouter(options: { appVersion: () => Promise<string> | string; feedUrl: () => string | undefined; fetchImpl?: typeof fetch }) {
  const router = new Hono();
  router.get('/check', async (c) => {
    const current = await options.appVersion();
    const feedUrl = options.feedUrl()?.trim();
    if (!feedUrl) return c.json(judgeUpdate(current, null, false));
    try {
      if (new URL(feedUrl).protocol !== 'https:') return c.json(judgeUpdate(current, null, true, '更新源必须是 https 地址'));
      const res = await (options.fetchImpl ?? fetch)(feedUrl, { signal: AbortSignal.timeout(8000), headers: { 'x-app-version': current, 'x-platform': process.platform } });
      if (!res.ok) return c.json(judgeUpdate(current, null, true, `更新源返回 HTTP ${res.status}`));
      const text = await res.text();
      if (text.length > MAX_FEED_BYTES) return c.json(judgeUpdate(current, null, true, '更新源内容过大'));
      return c.json(judgeUpdate(current, parseUpdateFeed(JSON.parse(text)), true));
    } catch (error) {
      return c.json(judgeUpdate(current, null, true, error instanceof Error ? error.message : '连接更新源失败'));
    }
  });
  return router;
}
