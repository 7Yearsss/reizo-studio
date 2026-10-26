import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from './sqliteSessionStore';

const msg = (id: string, role: 'user' | 'assistant', content: string) => ({ id, role, content, createdAt: new Date().toISOString() });

describe('SqliteSessionStore.searchMessages', () => {
  it('finds two-character and multi-term matches across sessions, skipping trash', async () => {
    const store = createSqliteSessionStore(openDb(':memory:'));
    const a = await store.create('报销', null, null);
    const b = await store.create('周报', null, null);
    const gone = await store.create('旧的', null, null);
    await store.appendMessage(a.id, msg('m1', 'user', '请帮我整理报销流程的步骤'));
    await store.appendMessage(b.id, msg('m2', 'assistant', '本周重点：报销系统上线，流程已确认'));
    await store.appendMessage(gone.id, msg('m3', 'user', '报销流程 旧版本'));
    await store.softDelete(gone.id);

    const two = await store.searchMessages('报销');
    expect(two.map((h) => h.messageId).sort()).toEqual(['m1', 'm2']);
    const both = await store.searchMessages('报销 流程');
    expect(both.map((h) => h.messageId).sort()).toEqual(['m1', 'm2']);
    expect(both[0].snippet).toContain('报销');
    expect(await store.searchMessages('不存在的词')).toEqual([]);
    expect(await store.searchMessages('   ')).toEqual([]);
  });

  it('treats % and _ literally', async () => {
    const store = createSqliteSessionStore(openDb(':memory:'));
    const s = await store.create('t', null, null);
    await store.appendMessage(s.id, msg('x1', 'user', 'discount 50% today'));
    await store.appendMessage(s.id, msg('x2', 'user', 'plain text'));
    expect((await store.searchMessages('50%')).map((h) => h.messageId)).toEqual(['x1']);
    expect(await store.searchMessages('%')).toHaveLength(1);
  });
});
