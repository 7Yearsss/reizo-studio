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
});
