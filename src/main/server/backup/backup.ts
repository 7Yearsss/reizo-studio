import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Local backups of everything Reizo keeps: a consistent copy of the SQLite database (`VACUUM INTO`) plus the
 * rest of the data folder (settings, canvases' assets, artifacts, skills, plugins…), saved as a plain folder with a
 * manifest. Restoring is staged and applied at the NEXT start, before the database is opened, by moving the
 * current data aside first — so a restore interrupted at any point rolls back instead of leaving half a profile.
 */

export const BACKUP_FORMAT = 1;
export const BACKUP_DIR_PREFIX = 'reizo-backup-';
const MANIFEST = 'manifest.json';
const JOURNAL = 'restore-pending.json';
const UNDO_DIR = 'restore-undo';
const BACKUPS_DIR = 'backups';
/** Never part of a backup or a restore: backups themselves, restore bookkeeping, the live database files, and cache-like folders. */
const NOT_BACKED_UP = new Set([BACKUPS_DIR, UNDO_DIR, JOURNAL, 'reizo.db', 'reizo.db-wal', 'reizo.db-shm', 'computer-use', 'traces']);
/** Kept in place by a restore: everything else is swapped. */
const KEPT_BY_RESTORE = new Set([BACKUPS_DIR, UNDO_DIR, JOURNAL]);

export class BackupBusyError extends Error {
  constructor() { super('有对话正在运行，已取消备份——等它结束后再试。'); }
}

export interface BackupManifest {
  format: number;
  createdAt: string;
  dbSha256: string;
  fileCount: number;
  bytes: number;
}

export interface BackupInfo { dir: string; name: string; manifest: BackupManifest }

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function walkSize(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const inner = await walkSize(full); files += inner.files; bytes += inner.bytes; }
    else if (entry.isFile()) { files += 1; bytes += (await stat(full)).size; }
  }
  return { files, bytes };
}

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

export function backupsDirOf(dataRoot: string): string { return path.join(dataRoot, BACKUPS_DIR); }

/** Take a backup. Refuses while a turn is running (its files are still changing). */
export async function createBackup(options: {
  dataRoot: string;
  db: DatabaseSync;
  hasActiveWork: () => boolean;
  backupsDir?: string;
  now?: Date;
}): Promise<BackupInfo> {
  if (options.hasActiveWork()) throw new BackupBusyError();
  const now = options.now ?? new Date();
  const root = options.backupsDir ?? backupsDirOf(options.dataRoot);
  const name = `${BACKUP_DIR_PREFIX}${stamp(now)}`;
  const finalDir = path.join(root, name);
  const partial = `${finalDir}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    const dbCopy = path.join(partial, 'reizo.db');
    options.db.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
    for (const entry of await readdir(options.dataRoot)) {
      if (NOT_BACKED_UP.has(entry) || entry.endsWith('.tmp')) continue;
      await cp(path.join(options.dataRoot, entry), path.join(partial, entry), { recursive: true });
    }
    const size = await walkSize(partial);
    const manifest: BackupManifest = { format: BACKUP_FORMAT, createdAt: now.toISOString(), dbSha256: await sha256(dbCopy), fileCount: size.files, bytes: size.bytes };
    await writeFile(path.join(partial, MANIFEST), JSON.stringify(manifest, null, 2), 'utf8');
    await rename(partial, finalDir);
    return { dir: finalDir, name, manifest };
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}

async function readManifest(dir: string): Promise<BackupManifest | null> {
  try {
    const value = JSON.parse(await readFile(path.join(dir, MANIFEST), 'utf8')) as Partial<BackupManifest>;
    return value.format === BACKUP_FORMAT && typeof value.dbSha256 === 'string' && typeof value.createdAt === 'string'
      ? (value as BackupManifest)
      : null;
  } catch { return null; }
}

/** Newest first. Half-written (`.partial`) and unreadable folders are ignored. */
export async function listBackups(backupsDir: string): Promise<BackupInfo[]> {
  const names = await readdir(backupsDir).catch((): string[] => []);
  const infos: BackupInfo[] = [];
  for (const name of names) {
    if (!name.startsWith(BACKUP_DIR_PREFIX) || name.endsWith('.partial')) continue;
    const manifest = await readManifest(path.join(backupsDir, name));
    if (manifest) infos.push({ dir: path.join(backupsDir, name), name, manifest });
  }
  return infos.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

/** Keep the newest `keep` backups; returns how many were removed. */
export async function pruneBackups(backupsDir: string, keep: number): Promise<number> {
  const all = await listBackups(backupsDir);
  const doomed = all.slice(Math.max(1, keep));
  for (const info of doomed) await rm(info.dir, { recursive: true, force: true });
  return doomed.length;
}

/** Is this folder a sound backup? Checks the manifest, the database fingerprint and SQLite's own integrity check. */
export interface BackupVerdict { ok: boolean; reason?: string; manifest?: BackupManifest }

export async function verifyBackup(dir: string): Promise<BackupVerdict> {
  const manifest = await readManifest(dir);
  if (!manifest) return { ok: false, reason: '不是有效的备份（缺少或无法识别 manifest）' };
  const dbFile = path.join(dir, 'reizo.db');
  try {
    if ((await sha256(dbFile)) !== manifest.dbSha256) return { ok: false, reason: '备份里的数据库已被改动或损坏（校验不一致）' };
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
      if (row?.integrity_check !== 'ok') return { ok: false, reason: '备份里的数据库未通过完整性检查' };
    } finally { db.close(); }
  } catch { return { ok: false, reason: '无法读取备份里的数据库' }; }
  return { ok: true, manifest };
}

interface Journal { state: 'staged' | 'applying'; backupDir: string; undoDir?: string; stagedAt: string }

async function readJournal(dataRoot: string): Promise<Journal | null> {
  try { return JSON.parse(await readFile(path.join(dataRoot, JOURNAL), 'utf8')) as Journal; } catch { return null; }
}
async function writeJournal(dataRoot: string, journal: Journal): Promise<void> {
  await writeFile(path.join(dataRoot, JOURNAL), JSON.stringify(journal, null, 2), 'utf8');
}

/** Queue a restore for the next start. Nothing in the live data changes now. */
export async function stageRestore(dataRoot: string, backupDir: string): Promise<BackupManifest> {
  const verdict = await verifyBackup(backupDir);
  if (!verdict.ok || !verdict.manifest) throw new Error(verdict.reason ?? '备份无效');
  await writeJournal(dataRoot, { state: 'staged', backupDir: path.resolve(backupDir), stagedAt: new Date().toISOString() });
  return verdict.manifest;
}

export async function hasPendingRestore(dataRoot: string): Promise<boolean> {
  return (await readJournal(dataRoot)) !== null;
}

async function moveEntries(from: string, to: string, skip: Set<string>): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    if (skip.has(entry)) continue;
    await rename(path.join(from, entry), path.join(to, entry));
  }
}

async function rollback(dataRoot: string, undoDir: string): Promise<void> {
  // Whatever the interrupted restore had put in place goes; the original profile comes back.
  for (const entry of await readdir(dataRoot)) if (!KEPT_BY_RESTORE.has(entry)) await rm(path.join(dataRoot, entry), { recursive: true, force: true });
  await moveEntries(undoDir, dataRoot, new Set());
  await rm(undoDir, { recursive: true, force: true });
  await rm(path.join(dataRoot, JOURNAL), { force: true });
}

export type RestoreOutcome =
  | { status: 'none' }
  | { status: 'restored'; undoDir: string }
  | { status: 'rolled-back'; reason: string }
  | { status: 'failed'; error: string };

/**
 * Call at startup BEFORE the database is opened. Applies a staged restore by moving the current data into
 * `restore-undo/` and copying the backup in; a journal left in the middle of that (the app was killed) is
 * rolled back instead. The previous data stays in `restore-undo/` after a successful restore.
 */
export async function applyPendingRestore(dataRoot: string): Promise<RestoreOutcome> {
  const journal = await readJournal(dataRoot);
  if (!journal) return { status: 'none' };
  if (journal.state === 'applying' && journal.undoDir) {
    await rollback(dataRoot, journal.undoDir);
    return { status: 'rolled-back', reason: '上次恢复在中途被打断，已回滚到恢复前的数据' };
  }
  const undoDir = path.join(dataRoot, UNDO_DIR, stamp(new Date()));
  // Rolling back is only right once something has been moved aside; before that the live data was never touched.
  let moved = false;
  try {
    const verdict = await verifyBackup(journal.backupDir);
    if (!verdict.ok) throw new Error(verdict.reason ?? '备份无效');
    await writeJournal(dataRoot, { ...journal, state: 'applying', undoDir });
    moved = true;
    await moveEntries(dataRoot, undoDir, KEPT_BY_RESTORE);
    for (const entry of await readdir(journal.backupDir)) {
      if (entry === MANIFEST) continue;
      await cp(path.join(journal.backupDir, entry), path.join(dataRoot, entry), { recursive: true });
    }
    await stat(path.join(dataRoot, 'reizo.db'));
    await rm(path.join(dataRoot, JOURNAL), { force: true });
    return { status: 'restored', undoDir };
  } catch (error) {
    if (moved) { try { await rollback(dataRoot, undoDir); } catch { /* keep the original error */ } }
    await rm(path.join(dataRoot, JOURNAL), { force: true });
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}
