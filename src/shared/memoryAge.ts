/** A memory not touched for this long is shown to the model with a warning. */
export const STALE_MEMORY_DAYS = 60;

export function memoryAgeDays(updatedAt: string | undefined, now: Date = new Date()): number | null {
  const time = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}

/**
 * Models weigh "written 90 days ago" far more than a raw timestamp. Empty for fresh or undated memories.
 */
export function staleMemoryNote(updatedAt: string | undefined, now: Date = new Date()): string {
  const days = memoryAgeDays(updatedAt, now);
  if (days === null || days <= STALE_MEMORY_DAYS) return '';
  return `（注意：这条记忆已 ${days} 天没有更新，可能已经过时；用它之前先向用户确认，或以工作区里的现状为准。）`;
}
