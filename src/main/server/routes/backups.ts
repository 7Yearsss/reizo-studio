import { Hono } from 'hono';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { DbHandle } from '../db/client';
import { writeTextAtomic } from '../storage/atomicFile';
import { anyTurnLive } from '../agent/session';
import { BackupBusyError, backupsDirOf, createBackup, listBackups, pruneBackups, stageRestore, verifyBackup } from '../backup/backup';

export interface BackupSettings { enabled: boolean; intervalHours: number; keep: number }
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { enabled: false, intervalHours: 24, keep: 7 };

const settingsFile = (dataRoot: string) => path.join(dataRoot, 'backup-settings.json');

export async function readBackupSettings(dataRoot: string): Promise<BackupSettings> {
  try {
    const value = JSON.parse(await readFile(settingsFile(dataRoot), 'utf8')) as Partial<BackupSettings>;
    return {
      enabled: value.enabled === true,
      intervalHours: Number.isFinite(value.intervalHours) ? Math.min(24 * 30, Math.max(1, Math.round(value.intervalHours as number))) : DEFAULT_BACKUP_SETTINGS.intervalHours,
      keep: Number.isFinite(value.keep) ? Math.min(60, Math.max(1, Math.round(value.keep as number))) : DEFAULT_BACKUP_SETTINGS.keep,
    };
  } catch { return { ...DEFAULT_BACKUP_SETTINGS }; }
}

/** One backup now (also used by the automatic schedule). Returns null when a turn is running. */
export async function runBackup(dataRoot: string, db: DbHandle): Promise<Awaited<ReturnType<typeof createBackup>> | null> {
  try {
    const info = await createBackup({ dataRoot, db: db.raw, hasActiveWork: anyTurnLive });
    await pruneBackups(backupsDirOf(dataRoot), (await readBackupSettings(dataRoot)).keep);
    return info;
  } catch (error) {
    if (error instanceof BackupBusyError) return null;
    throw error;
  }
}

export function createBackupRouter(options: { dataRoot: string; db: DbHandle }) {
  const router = new Hono();
  const dir = backupsDirOf(options.dataRoot);

  router.get('/', async (c) => c.json({
    backups: (await listBackups(dir)).map((b) => ({ name: b.name, createdAt: b.manifest.createdAt, bytes: b.manifest.bytes, files: b.manifest.fileCount })),
    settings: await readBackupSettings(options.dataRoot),
  }));

  router.post('/', async (c) => {
    try {
      const info = await runBackup(options.dataRoot, options.db);
      if (!info) return c.json({ error: new BackupBusyError().message }, 409);
      return c.json({ backup: { name: info.name, createdAt: info.manifest.createdAt, bytes: info.manifest.bytes, files: info.manifest.fileCount } }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  router.put('/settings', async (c) => {
    const body = (await c.req.json().catch((): null => null)) as Partial<BackupSettings> | null;
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const current = await readBackupSettings(options.dataRoot);
    const next: BackupSettings = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      intervalHours: typeof body.intervalHours === 'number' ? body.intervalHours : current.intervalHours,
      keep: typeof body.keep === 'number' ? body.keep : current.keep,
    };
    await writeTextAtomic(settingsFile(options.dataRoot), JSON.stringify(next));
    return c.json({ settings: await readBackupSettings(options.dataRoot) });
  });

  // Queue a restore: the data is swapped at the next start, before the database opens. Nothing changes now.
  router.post('/:name/restore', async (c) => {
    const name = c.req.param('name');
    if (name !== path.basename(name)) return c.json({ error: 'Invalid backup name' }, 400);
    if (anyTurnLive()) return c.json({ error: '有对话正在运行，请等它结束后再恢复。' }, 409);
    const verdict = await verifyBackup(path.join(dir, name));
    if (!verdict.ok) return c.json({ error: verdict.reason }, 400);
    try {
      await stageRestore(options.dataRoot, path.join(dir, name));
      return c.json({ staged: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  return router;
}
