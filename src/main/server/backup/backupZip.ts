import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough } from 'fflate';
import { BACKUP_DIR_PREFIX, verifyBackup } from './backup';

/**
 * One backup folder <-> one .zip file, for moving to another machine. Files are stored (not compressed): the
 * bulk is already-compressed media and a database, and it keeps both directions streaming and cheap.
 * Nothing is trusted on the way in: entries that would land outside the target are refused (zip-slip), and the
 * result must pass the same `verifyBackup` as a locally made backup before it shows up in the list.
 */

async function* walk(dir: string, base = ''): AsyncGenerator<{ rel: string; full: string }> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, rel);
    else if (entry.isFile()) yield { rel, full };
  }
}

/** Write `backupDir` as a zip at `outFile`. Reads one file at a time. */
export async function exportBackupZip(backupDir: string, outFile: string): Promise<void> {
  const out = createWriteStream(outFile);
  const zip = new Zip((error, chunk, final) => {
    if (error) { out.destroy(error); return; }
    out.write(chunk);
    if (final) out.end();
  });
  try {
    for await (const { rel, full } of walk(backupDir)) {
      const entry = new ZipPassThrough(rel);
      zip.add(entry);
      entry.push(await readFile(full), true);
    }
    zip.end();
    await once(out, 'finish');
  } catch (error) {
    out.destroy();
    await rm(outFile, { force: true });
    throw error;
  }
}

/** True when a zip entry name stays inside the extraction folder. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.includes('\\')) return false;
  return name.split('/').every((part) => part !== '..');
}

export class BackupZipError extends Error {}

/**
 * Unpack a backup zip into `<backupsDir>/reizo-backup-imported-<time>` and return its name. Anything wrong (bad zip,
 * unsafe entry name, failed verification) leaves nothing behind.
 */
export async function importBackupZip(zipFile: string, backupsDir: string): Promise<string> {
  await mkdir(backupsDir, { recursive: true });
  const name = `${BACKUP_DIR_PREFIX}imported-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')}`;
  const staging = path.join(backupsDir, `${name}.partial`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const writers: Array<Promise<void>> = [];
  let failure: Error | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file) => {
    if (failure) return;
    if (file.name.endsWith('/')) return; // a directory entry
    if (!isSafeEntryName(file.name)) { failure = new BackupZipError(`压缩包里有不安全的路径：${file.name}`); return; }
    const target = path.join(staging, ...file.name.split('/'));
    const ready = mkdir(path.dirname(target), { recursive: true }).then(() => createWriteStream(target));
    const done = ready.then((stream) => new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', resolve);
      file.ondata = (error, chunk, final) => {
        if (error) { failure = error; stream.destroy(error); return; }
        stream.write(chunk);
        if (final) stream.end();
      };
      file.start();
    }));
    writers.push(done);
  };

  try {
    for await (const chunk of createReadStream(zipFile)) {
      unzip.push(chunk as Uint8Array, false);
      if (failure) throw failure;
    }
    unzip.push(new Uint8Array(0), true);
    await Promise.all(writers);
    if (failure) throw failure;
    if (!(await stat(staging).catch((): null => null))) throw new BackupZipError('压缩包是空的');
    const verdict = await verifyBackup(staging);
    if (!verdict.ok) throw new BackupZipError(verdict.reason ?? '这不是 Reizo 的备份压缩包');
    await rename(staging, path.join(backupsDir, name));
    return name;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error instanceof BackupZipError ? error : new BackupZipError(error instanceof Error ? `无法读取压缩包：${error.message}` : '无法读取压缩包');
  }
}
