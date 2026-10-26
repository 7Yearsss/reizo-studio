export type DiskLevel = 'ok' | 'low' | 'critical';

const GB = 1024 ** 3;
export const DISK_LOW_BYTES = 5 * GB;
export const DISK_CRITICAL_BYTES = 1 * GB;

/** Canvas video and backups are large; warn early (5 GB) and loudly (1 GB). */
export function diskLevel(freeBytes: number): DiskLevel {
  if (!Number.isFinite(freeBytes) || freeBytes < 0) return 'ok';
  if (freeBytes < DISK_CRITICAL_BYTES) return 'critical';
  if (freeBytes < DISK_LOW_BYTES) return 'low';
  return 'ok';
}

/** How long to wait before looking again: often when nearly full, rarely when there is plenty of room. */
export function nextDiskCheckMs(freeBytes: number): number {
  const minutes = diskLevel(freeBytes) === 'critical' ? 5 : diskLevel(freeBytes) === 'low' ? 15 : 60;
  return minutes * 60_000;
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}

/** Warn when the level gets worse than the last one we warned about; recovering resets it. */
export function shouldWarnDisk(previous: DiskLevel, current: DiskLevel): boolean {
  const rank: Record<DiskLevel, number> = { ok: 0, low: 1, critical: 2 };
  return rank[current] > rank[previous];
}
