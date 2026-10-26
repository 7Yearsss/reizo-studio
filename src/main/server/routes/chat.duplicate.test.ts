import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createChatRouter } from './chat';

describe('POST /:id/messages with a clientTurnId already taken', () => {
  it('answers 409 duplicate_turn and adds nothing, so a retry after a lost response yields one turn', async () => {
    const sessionStore = createSqliteSessionStore(openDb(':memory:'));
    const session = await sessionStore.create('t', null, null);
    await sessionStore.appendMessage(session.id, { id: 'u1', role: 'user', content: 'hello', createdAt: new Date().toISOString(), clientId: 't-retry-0001' });
    const router = createChatRouter(sessionStore, {} as never);

    const res = await router.request(`/${session.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', clientTurnId: 't-retry-0001' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('duplicate_turn');
    expect((await sessionStore.get(session.id))?.messages).toHaveLength(1);
  });
});
