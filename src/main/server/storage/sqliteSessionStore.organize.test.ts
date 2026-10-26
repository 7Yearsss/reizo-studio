import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from './sqliteSessionStore';

describe('SqliteSessionStore pin / archive', () => {
  it('pins and archives without moving updatedAt; archiving drops the pin; both reverse', async () => {
    const store = createSqliteSessionStore(openDb(':memory:'));
    const s = await store.create('keep', null, null);
    const before = (await store.get(s.id))!.updatedAt;

    const pinned = await store.update(s.id, { pinned: true });
    expect(pinned.pinnedAt).toBeTruthy();
    expect(pinned.updatedAt).toBe(before);

    const archived = await store.update(s.id, { archived: true });
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.pinnedAt).toBeNull();
    expect(archived.updatedAt).toBe(before);
    expect(await store.list()).toHaveLength(1); // archived sessions stay listed (and so searchable)

    const back = await store.update(s.id, { archived: false });
    expect(back.archivedAt).toBeNull();
  });

  it('a rename still bumps updatedAt', async () => {
    const store = createSqliteSessionStore(openDb(':memory:'));
    const s = await store.create('a', null, null);
    await new Promise((r) => setTimeout(r, 5));
    const renamed = await store.update(s.id, { title: 'b' });
    expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(Date.parse(s.updatedAt));
  });
});
