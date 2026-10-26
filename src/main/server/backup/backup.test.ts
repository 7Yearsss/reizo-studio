import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingRestore, backupsDirOf, BackupBusyError, createBackup, hasPendingRestore, listBackups, pruneBackups, stageRestore, verifyBackup } from './backup';

let root: string;
let db: DatabaseSync;

async function write(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}
const rows = (file: string) => {
  const handle = new DatabaseSync(file, { readOnly: true });
  try { return (handle.prepare('SELECT v FROM t ORDER BY v').all() as Array<{ v: string }>).map((r) => r.v); } finally { handle.close(); }
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'reizo-backup-'));
  db = new DatabaseSync(path.join(root, 'reizo.db'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT)');
  db.prepare('INSERT INTO t VALUES (?)').run('会话一');
  await write(path.join(root, 'settings.json'), '{"theme":"dark"}');
  await write(path.join(root, 'canvas', 'assets', 'a.png'), 'PNG-A');
  await write(path.join(root, 'computer-use', 'shot.png'), 'cache'); // not worth backing up
});
afterEach(async () => { try { db.close(); } catch { /* already closed */ } await rm(root, { recursive: true, force: true }); });

describe('createBackup', () => {
  it('copies the database consistently and the data files, but not caches or earlier backups', async () => {
    const info = await createBackup({ dataRoot: root, db, hasActiveWork: () => false });
    expect(rows(path.join(info.dir, 'reizo.db'))).toEqual(['会话一']);
    expect(await readFile(path.join(info.dir, 'settings.json'), 'utf8')).toContain('dark');
    expect(await readFile(path.join(info.dir, 'canvas', 'assets', 'a.png'), 'utf8')).toBe('PNG-A');
    expect(await readdir(info.dir)).not.toContain('computer-use');
    const second = await createBackup({ dataRoot: root, db, hasActiveWork: () => false, now: new Date(Date.now() + 5000) });
    expect(await readdir(second.dir)).not.toContain('backups');
    expect(await verifyBackup(info.dir)).toMatchObject({ ok: true });
  });

  it('refuses while a turn is running, and leaves no half-written folder', async () => {
    await expect(createBackup({ dataRoot: root, db, hasActiveWork: () => true })).rejects.toBeInstanceOf(BackupBusyError);
    expect(await readdir(backupsDirOf(root)).catch((): string[] => [])).toEqual([]);
  });

  it('lists newest first and keeps only the newest N', async () => {
    for (let i = 0; i < 4; i++) await createBackup({ dataRoot: root, db, hasActiveWork: () => false, now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
    const all = await listBackups(backupsDirOf(root));
    expect(all).toHaveLength(4);
    expect(all[0].manifest.createdAt > all[3].manifest.createdAt).toBe(true);
    expect(await pruneBackups(backupsDirOf(root), 2)).toBe(2);
    expect((await listBackups(backupsDirOf(root))).map((b) => b.name)).toEqual(all.slice(0, 2).map((b) => b.name));
  });
});

describe('verify, stage and restore', () => {
  it('rejects a tampered database and non-backups before touching anything', async () => {
    const info = await createBackup({ dataRoot: root, db, hasActiveWork: () => false });
    await write(path.join(info.dir, 'reizo.db'), 'not a database anymore');
    expect(await verifyBackup(info.dir)).toMatchObject({ ok: false });
    await expect(stageRestore(root, info.dir)).rejects.toThrow();
    expect(await hasPendingRestore(root)).toBe(false);
    expect(await verifyBackup(root)).toMatchObject({ ok: false });
  });

  it('restores the data at the next start and keeps the replaced data in restore-undo', async () => {
    const info = await createBackup({ dataRoot: root, db, hasActiveWork: () => false });
    db.prepare('INSERT INTO t VALUES (?)').run('之后新增');
    await write(path.join(root, 'settings.json'), '{"theme":"light"}');
    await write(path.join(root, 'only-now.txt'), 'x');
    db.close();

    await stageRestore(root, info.dir);
    expect(rows(path.join(root, 'reizo.db'))).toContain('之后新增'); // staging changes nothing yet
    const outcome = await applyPendingRestore(root);
    expect(outcome.status).toBe('restored');
    expect(rows(path.join(root, 'reizo.db'))).toEqual(['会话一']);
    expect(await readFile(path.join(root, 'settings.json'), 'utf8')).toContain('dark');
    expect(await readdir(root)).not.toContain('only-now.txt');
    if (outcome.status === 'restored') expect(await readdir(outcome.undoDir)).toContain('only-now.txt');
    expect(await hasPendingRestore(root)).toBe(false);
    expect(await readdir(root)).toContain('backups');
  });

  it('killed midway (journal says applying): the next start rolls back to the pre-restore data', async () => {
    const info = await createBackup({ dataRoot: root, db, hasActiveWork: () => false });
    db.prepare('INSERT INTO t VALUES (?)').run('恢复前的数据');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    // Simulate the crash: the live data was already moved aside, the backup only partly copied in.
    const undo = path.join(root, 'restore-undo', 'crashed');
    await mkdir(undo, { recursive: true });
    for (const entry of ['reizo.db', 'settings.json', 'canvas']) await (await import('node:fs/promises')).rename(path.join(root, entry), path.join(undo, entry));
    await write(path.join(root, 'settings.json'), '{"half":"copied"}');
    await write(path.join(root, 'restore-pending.json'), JSON.stringify({ state: 'applying', backupDir: info.dir, undoDir: undo, stagedAt: new Date().toISOString() }));

    expect(await applyPendingRestore(root)).toMatchObject({ status: 'rolled-back' });
    expect(rows(path.join(root, 'reizo.db'))).toEqual(['会话一', '恢复前的数据']);
    expect(await readFile(path.join(root, 'settings.json'), 'utf8')).toContain('dark');
    expect(await hasPendingRestore(root)).toBe(false);
  });

  it('a backup that went bad after staging fails safely and leaves the data alone', async () => {
    const info = await createBackup({ dataRoot: root, db, hasActiveWork: () => false });
    db.close();
    await stageRestore(root, info.dir);
    await write(path.join(info.dir, 'reizo.db'), 'garbage');
    expect(await applyPendingRestore(root)).toMatchObject({ status: 'failed' });
    expect(rows(path.join(root, 'reizo.db'))).toEqual(['会话一']);
    expect(await hasPendingRestore(root)).toBe(false);
  });

  it('with no journal it does nothing', async () => {
    expect(await applyPendingRestore(root)).toEqual({ status: 'none' });
  });
});
