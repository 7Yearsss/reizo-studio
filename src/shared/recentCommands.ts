const MAX = 5;

/** Move `id` to the front of the recently used commands, without duplicates, keeping the newest five. */
export function recordRecent(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, MAX);
}

export function parseRecent(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 300))].slice(0, MAX) : [];
}

/** The recents that still exist, in recency order. Commands that vanished (a deleted session) just drop out. */
export function resolveRecent<T extends { id: string }>(ids: readonly string[], items: readonly T[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return ids.map((id) => byId.get(id)).filter((i): i is T => !!i);
}
