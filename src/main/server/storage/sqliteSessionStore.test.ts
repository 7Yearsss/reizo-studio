import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from './sqliteSessionStore';
import type { ChatMessage } from '../../../shared/chat';

function msg(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, role, content, createdAt: new Date().toISOString() };
}

function freshStore() {
  const handle = openDb(':memory:');
  return { store: createSqliteSessionStore(handle), handle };
}

describe('SqliteSessionStore', () => {
  it('creates, lists, gets, renames, updates, removes', async () => {
    const { store } = freshStore();

    const created = await store.create('First', 'C:\\ws', null);
    expect(created.title).toBe('First');
    expect(created.messages).toEqual([]);
    expect(created.workspacePath).toBe('C:\\ws');

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const renamed = await store.rename(created.id, 'Renamed');
    expect(renamed.title).toBe('Renamed');

    const updated = await store.update(created.id, { title: '  Trimmed  ' });
    expect(updated.title).toBe('Trimmed');

    await store.remove(created.id);
    expect(await store.get(created.id)).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });

  it('append updates the sidebar projection and message order', async () => {
    const { store } = freshStore();
    const s = await store.create('Chat');

    await store.appendMessage(s.id, msg('u1', 'user', 'hello there'));
    await store.appendMessage(s.id, msg('a1', 'assistant', 'hi back'));

    const full = await store.get(s.id);
    expect(full?.messages.map((m) => m.id)).toEqual(['u1', 'a1']);

    const summary = (await store.list())[0];
    expect(summary.listMessageCount).toBe(2);
    expect(summary.listPreview).toBe('hi back');
    expect(summary.listPreviewRole).toBe('assistant');
  });

  it('round-trips tool parts through content JSON', async () => {
    const { store } = freshStore();
    const s = await store.create('Chat');
    const withParts: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: 'done',
      createdAt: new Date().toISOString(),
      parts: [{ type: 'tool', id: 't1', name: 'read_file', args: { path: 'x.ts' }, result: 'ok' }],
    };
    await store.appendMessage(s.id, withParts);
    const back = await store.get(s.id);
    expect(back?.messages[0].parts?.[0]).toMatchObject({ id: 't1', name: 'read_file', result: 'ok' });
  });

  it('setMessages soft-deletes the dropped tail but keeps it as audit trail', async () => {
    const { store, handle } = freshStore();
    const s = await store.create('Chat');
    for (const [id, role, text] of [
      ['u1', 'user', 'a'],
      ['a1', 'assistant', 'b'],
      ['u2', 'user', 'c'],
      ['a2', 'assistant', 'd'],
    ] as const) {
      await store.appendMessage(s.id, msg(id, role, text));
    }

    const current = await store.get(s.id);
    const truncated = await store.setMessages(s.id, (current?.messages ?? []).slice(0, 2));
    expect(truncated.messages.map((m) => m.id)).toEqual(['u1', 'a1']);

    const activeCount = handle.raw
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND rewind_at IS NULL')
      .get(s.id) as { n: number };
    const totalCount = handle.raw
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?')
      .get(s.id) as { n: number };
    expect(activeCount.n).toBe(2);
    expect(totalCount.n).toBe(4);

    const summary = (await store.list())[0];
    expect(summary.listMessageCount).toBe(2);
    expect(summary.listPreview).toBe('b');
  });

  it('rejects appends to a missing session', async () => {
    const { store } = freshStore();
    await expect(store.appendMessage('nope', msg('u1', 'user', 'x'))).rejects.toThrow(/Session not found/);
  });

  it('serializes concurrent appends without losing rows', async () => {
    const { store } = freshStore();
    const s = await store.create('Chat');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.appendMessage(s.id, msg(`m${i}`, 'user', `#${i}`))),
    );
    const back = await store.get(s.id);
    expect(back?.messages).toHaveLength(20);
    expect(new Set(back?.messages.map((m) => m.id)).size).toBe(20);
  });
});
