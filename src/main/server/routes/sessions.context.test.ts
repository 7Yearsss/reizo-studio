import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createSessionsRouter } from './sessions';

describe('GET /:id/context', () => {
  it('reports an estimate and tier, and 404s for unknown sessions', async () => {
    const handle = openDb(':memory:');
    const store = createSqliteSessionStore(handle);
    const session = await store.create('t');
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: '你好'.repeat(1000), createdAt: new Date().toISOString() });
    const router = createSessionsRouter(store);
    const body = await (await router.request(`/${session.id}/context`)).json() as { usedTokens: number; windowTokens: number; level: string };
    expect(body.usedTokens).toBeGreaterThan(900);
    expect(body.windowTokens).toBe(128_000);
    expect(body.level).toBe('ok');
    expect((await router.request('/nope/context')).status).toBe(404);
    handle.close();
  });

  it('prefers the provider-reported size of the last request over the estimate', async () => {
    const handle = openDb(':memory:');
    const store = createSqliteSessionStore(handle);
    const session = await store.create('t');
    const t = Date.now();
    await store.appendMessage(session.id, { id: 'u1', role: 'user', content: 'hi', createdAt: new Date(t - 2000).toISOString() });
    await store.appendMessage(session.id, { id: 'a1', role: 'assistant', content: 'yo', createdAt: new Date(t - 1000).toISOString() });
    const router = createSessionsRouter(store, undefined, undefined, undefined, undefined, () => ({ inputTokens: 40_000, outputTokens: 500, at: t - 1500 }));
    const body = await (await router.request(`/${session.id}/context`)).json() as { usedTokens: number; source: string };
    expect(body).toMatchObject({ usedTokens: 40_500, source: 'reported' });
    handle.close();
  });
});
