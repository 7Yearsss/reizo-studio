import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { isCompactBoundary, messagesForModel } from '../../../shared/compactBoundary';
import { buildTranscript, compactSession } from './compaction';

async function seed(turns: number) {
  const handle = openDb(':memory:');
  const store = createSqliteSessionStore(handle);
  const session = await store.create('t');
  for (let i = 0; i < turns; i++) {
    await store.appendMessage(session.id, { id: `u${i}`, role: 'user', content: `问题${i} key sk-${'a'.repeat(30)}`, createdAt: new Date().toISOString() });
    await store.appendMessage(session.id, { id: `a${i}`, role: 'assistant', content: `回答${i}`, createdAt: new Date().toISOString() });
  }
  return { handle, store, id: session.id };
}

describe('compactSession', () => {
  it('appends a boundary, keeps every message, and shrinks what the model sees', async () => {
    const { handle, store, id } = await seed(5);
    let prompt = '';
    const result = await compactSession({
      sessionStore: store, sessionId: id, keepRecentTurns: 1, source: 'manual',
      rewriteText: async (_system, p) => { prompt = p; return '目标：做预算表\n已完成：前四轮'; },
    });
    expect(result).toMatchObject({ compacted: true });
    const after = (await store.get(id))!;
    expect(after.messages.filter((m) => !isCompactBoundary(m))).toHaveLength(10); // nothing deleted
    const seen = messagesForModel(after.messages);
    expect(seen[0].content).toContain('目标：做预算表');
    expect(seen.map((m) => m.id).slice(1)).toEqual(['u4', 'a4']);
    expect(prompt).toContain('问题0');
    expect(prompt).not.toContain('a'.repeat(30)); // secrets are masked before leaving
    handle.close();
  });

  it('does nothing for a short conversation or an empty summary, and writes no boundary', async () => {
    const { handle, store, id } = await seed(1);
    const called = { n: 0 };
    expect(await compactSession({ sessionStore: store, sessionId: id, keepRecentTurns: 1, source: 'manual', rewriteText: async () => { called.n++; return 'x'; } }))
      .toMatchObject({ compacted: false, reason: 'nothing_to_compact' });
    expect(called.n).toBe(0);
    handle.close();
    const longer = await seed(4);
    expect(await compactSession({ sessionStore: longer.store, sessionId: longer.id, keepRecentTurns: 1, source: 'auto', rewriteText: async () => '   ' }))
      .toMatchObject({ compacted: false, reason: 'empty_summary' });
    expect((await longer.store.get(longer.id))!.messages.some(isCompactBoundary)).toBe(false);
    longer.handle.close();
  });

  it('a failing summariser leaves the session untouched', async () => {
    const { handle, store, id } = await seed(4);
    await expect(compactSession({ sessionStore: store, sessionId: id, keepRecentTurns: 1, source: 'manual', rewriteText: async () => { throw new Error('429'); } })).rejects.toThrow('429');
    expect((await store.get(id))!.messages).toHaveLength(8);
    handle.close();
  });

  it('caps the transcript it sends', () => {
    const big = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: 'user' as const, content: 'x'.repeat(5000), createdAt: '' }));
    expect(buildTranscript(big).length).toBeLessThanOrEqual(60_001);
  });
});
