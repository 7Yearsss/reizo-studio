import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupsDirOf, createBackup, listBackups, verifyBackup } from './backup';
import { BackupZipError, exportBackupZip, importBackupZip, isSafeEntryName } from './backupZip';

let root: string;
let other: string;
let db: DatabaseSync;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'reizo-zip-a-'));
  other = await mkdtemp(path.join(os.tmpdir(), 'reizo-zip-b-'));
  db = new DatabaseSync(path.join(root, 'reizo.db'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT)');
  db.prepare('INSERT INTO t VALUES (?)').run('会话一');
  await mkdir(path.join(root, 'canvas', 'assets'), { recursive: true });
  await writeFile(path.join(root, 'settings.json'), '{"theme":"dark"}');
  await writeFile(path.join(root, 'canvas', 'assets', 'a.png'), Buffer.from([0, 1, 2, 3, 250, 251]));
});
afterEach(async () => {
  try { db.close(); } catch { /* closed */ }
  await rm(root, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

describe('backup zip', () => {
  it('a backup exported on one machine imports on another and verifies, byte for byte', async () => {
    const info = await createBackup({ dataRoot: root, db, hasActiveWork: () => false });
    const zipFile = path.join(root, 'out.zip');
    await exportBackupZip(info.dir, zipFile);

    const name = await importBackupZip(zipFile, backupsDirOf(other));
    const imported = (await listBackups(backupsDirOf(other)))[0];
    expect(imported.name).toBe(name);
    expect(await verifyBackup(imported.dir)).toMatchObject({ ok: true });
    expect([...(await readFile(path.join(imported.dir, 'canvas', 'assets', 'a.png')))]).toEqual([0, 1, 2, 3, 250, 251]);
    expect(await readFile(path.join(imported.dir, 'settings.json'), 'utf8')).toContain('dark');
  });

  it('refuses entries that would escape the folder, and leaves nothing behind', async () => {
    const evil = path.join(other, 'evil.zip');
    await writeFile(evil, zipSync({ '../../escape.txt': new TextEncoder().encode('x'), 'manifest.json': new TextEncoder().encode('{}') }, { level: 0 }));
    await expect(importBackupZip(evil, backupsDirOf(other))).rejects.toBeInstanceOf(BackupZipError);
    expect((await readdir(backupsDirOf(other))).filter((n) => n.startsWith('reizo-backup-'))).toEqual([]);
    await expect(readFile(path.join(other, 'escape.txt'))).rejects.toBeTruthy();
  });

  it('refuses a zip that is not a Reizo backup, and a tampered database', async () => {
    const plain = path.join(other, 'plain.zip');
    await writeFile(plain, zipSync({ 'hello.txt': new TextEncoder().encode('hi') }));
    await expect(importBackupZip(plain, backupsDirOf(other))).rejects.toBeInstanceOf(BackupZipError);

    const info = await createBackup({ dataRoot: root, db, hasActiveWork: () => false });
    await writeFile(path.join(info.dir, 'reizo.db'), 'tampered');
    const tampered = path.join(other, 'tampered.zip');
    await exportBackupZip(info.dir, tampered);
    await expect(importBackupZip(tampered, backupsDirOf(other))).rejects.toThrow();
    expect((await readdir(backupsDirOf(other))).filter((n) => n.startsWith('reizo-backup-'))).toEqual([]);
  });

  it('entry-name safety', () => {
    for (const bad of ['../x', 'a/../../x', '/abs', 'C:/x', 'a\\b', '']) expect(isSafeEntryName(bad)).toBe(false);
    for (const ok of ['reizo.db', 'canvas/assets/a.png']) expect(isSafeEntryName(ok)).toBe(true);
  });
});
