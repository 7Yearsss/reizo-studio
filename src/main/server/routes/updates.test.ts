import { describe, expect, it } from 'vitest';
import { createUpdatesRouter } from './updates';

const feed = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as never;
const get = async (router: ReturnType<typeof createUpdatesRouter>) => (await router.request('/check')).json() as Promise<{ status: string; latest?: string }>;

describe('GET /check', () => {
  it('is disabled without a feed, and offers a newer version from one', async () => {
    expect((await get(createUpdatesRouter({ appVersion: () => '0.1.1', feedUrl: () => undefined }))).status).toBe('disabled');
    const body = await get(createUpdatesRouter({ appVersion: () => '0.1.1', feedUrl: () => 'https://feed.test/u.json', fetchImpl: feed({ version: '0.2.0', url: 'https://dl.test/0.2.0' }) }));
    expect(body).toMatchObject({ status: 'available', latest: '0.2.0' });
  });
  it('reports an error rather than "latest" when the feed is broken or insecure', async () => {
    expect((await get(createUpdatesRouter({ appVersion: () => '0.1.1', feedUrl: () => 'https://feed.test/u.json', fetchImpl: feed({}, 500) }))).status).toBe('error');
    expect((await get(createUpdatesRouter({ appVersion: () => '0.1.1', feedUrl: () => 'http://feed.test/u.json' }))).status).toBe('error');
  });
});
