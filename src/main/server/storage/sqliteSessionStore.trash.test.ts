import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DbHandle } from '../db/client';
import { createSqliteSessionStore } from './sqliteSessionStore';

describe('session trash', () => {
  let handle: DbHandle;
  beforeEach(() => { handle = openDb(':memory:'); });
  afterEach(() => handle.close());

  it('soft delete hides from list, restore brings it back with messages', async () => {
    const store = createSqliteSessionStore(handle);
    const s = await store.create('keep me');
    await store.appendMessage(s.id, { id: 'm1', role: 'user', content: 'hi', createdAt: new Date().toISOString() });
    await store.softDelete(s.id);
    expect((await store.list()).map((x) => x.id)).not.toContain(s.id);
    expect((await store.listDeleted()).map((x) => x.id)).toEqual([s.id]);
    expect(await store.restore(s.id)).toBe(true);
    expect((await store.get(s.id))?.messages).toHaveLength(1);
    expect(await store.restore(s.id)).toBe(false);
  });

  it('purgeExpired removes only sessions trashed longer ago than the retention', async () => {
    const store = createSqliteSessionStore(handle);
    const old = await store.create('old');
    const fresh = await store.create('fresh');
    await store.softDelete(old.id);
    await store.softDelete(fresh.id);
    handle.raw.prepare('UPDATE sessions SET deleted_at = ? WHERE id = ?').run(Date.now() - 40 * 86_400_000, old.id);
    expect(await store.purgeExpired(30 * 86_400_000)).toEqual([old.id]);
    expect(await store.get(old.id)).toBeNull();
    expect((await store.listDeleted()).map((x) => x.id)).toEqual([fresh.id]);
  });
});
