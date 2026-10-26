import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DbHandle } from '../db/client';
import { applyPendingRestore } from '../backup/backup';
import { createBackupRouter, readBackupSettings } from './backups';

describe('backup routes', () => {
  let root: string;
  let handle: DbHandle;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'reizo-backup-route-'));
    handle = openDb(path.join(root, 'reizo.db'));
    await writeFile(path.join(root, 'settings.json'), '{"v":1}');
  });
  afterEach(async () => { try { handle.close(); } catch { /* closed */ } await rm(root, { recursive: true, force: true }); });

  const call = (router: ReturnType<typeof createBackupRouter>, url: string, init?: RequestInit) => router.request(url, init);
  const json = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('backs up, lists, queues a restore, and the next start swaps the data back', async () => {
    const router = createBackupRouter({ dataRoot: root, db: handle });
    const created = await call(router, '/', { method: 'POST' });
    expect(created.status).toBe(201);
    const { backup } = await created.json() as { backup: { name: string } };
    expect(((await (await call(router, '/')).json()) as { backups: unknown[] }).backups).toHaveLength(1);

    await writeFile(path.join(root, 'settings.json'), '{"v":2}');
    expect((await call(router, `/${backup.name}/restore`, { method: 'POST' })).status).toBe(200);
    expect(await readFile(path.join(root, 'settings.json'), 'utf8')).toBe('{"v":2}'); // nothing changes until the next start
    handle.close();
    expect((await applyPendingRestore(root)).status).toBe('restored');
    expect(await readFile(path.join(root, 'settings.json'), 'utf8')).toBe('{"v":1}');
  });

  it('refuses unknown or path-like backup names', async () => {
    const router = createBackupRouter({ dataRoot: root, db: handle });
    expect((await call(router, '/nope/restore', { method: 'POST' })).status).toBe(400);
    expect((await call(router, `/${encodeURIComponent('../x')}/restore`, { method: 'POST' })).status).toBe(400);
  });

  it('automatic backup settings are clamped and off by default', async () => {
    expect(await readBackupSettings(root)).toEqual({ enabled: false, intervalHours: 24, keep: 7 });
    const router = createBackupRouter({ dataRoot: root, db: handle });
    await call(router, '/settings', json({ enabled: true, intervalHours: 99999, keep: 0 }));
    expect(await readBackupSettings(root)).toEqual({ enabled: true, intervalHours: 720, keep: 1 });
  });
});
