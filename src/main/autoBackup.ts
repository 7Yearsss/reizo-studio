import type { DbHandle } from './server/db/client';
import { backupsDirOf, listBackups } from './server/backup/backup';
import { readBackupSettings, runBackup } from './server/routes/backups';

const STARTUP_GRACE_MS = 60_000;
const CHECK_EVERY_MS = 30 * 60_000;

/**
 * Optional scheduled backups (off until the user turns them on). After a minute of grace at startup, and then every
 * half hour, take a backup if the newest one is older than the chosen interval. A busy moment just means "try again later".
 */
export function startAutoBackup(dataRoot: string, getDb: () => DbHandle | null): () => void {
  let stopped = false;
  let running = false;
  async function tick(): Promise<void> {
    if (stopped || running) return;
    running = true;
    try {
      const settings = await readBackupSettings(dataRoot);
      const db = getDb();
      if (!settings.enabled || !db) return;
      const newest = (await listBackups(backupsDirOf(dataRoot)))[0];
      const age = newest ? Date.now() - Date.parse(newest.manifest.createdAt) : Infinity;
      if (age < settings.intervalHours * 3_600_000) return;
      await runBackup(dataRoot, db);
    } catch (error) {
      console.warn('[backup] automatic backup failed', error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  }
  const first = setTimeout(() => void tick(), STARTUP_GRACE_MS);
  const timer = setInterval(() => void tick(), CHECK_EVERY_MS);
  first.unref?.();
  timer.unref?.();
  return () => { stopped = true; clearTimeout(first); clearInterval(timer); };
}
