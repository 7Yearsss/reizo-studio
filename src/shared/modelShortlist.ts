export interface ModelShortlist {
  favorites: string[];
  recent: string[];
}

export const EMPTY_SHORTLIST: ModelShortlist = { favorites: [], recent: [] };
const MAX_RECENT = 5;
const MAX_FAVORITES = 12;

const strings = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 300))].slice(0, max) : [];

/** Parse what was stored; anything unexpected becomes an empty list rather than an error. */
export function parseShortlist(raw: unknown): ModelShortlist {
  if (!raw || typeof raw !== 'object') return EMPTY_SHORTLIST;
  const r = raw as Record<string, unknown>;
  return { favorites: strings(r.favorites, MAX_FAVORITES), recent: strings(r.recent, MAX_RECENT) };
}

/** Picking a model moves it to the front of the recents (a favourite does not need a recent slot too). */
export function recordPick(list: ModelShortlist, value: string): ModelShortlist {
  return { ...list, recent: [value, ...list.recent.filter((v) => v !== value)].slice(0, MAX_RECENT) };
}

export function toggleFavorite(list: ModelShortlist, value: string): ModelShortlist {
  const has = list.favorites.includes(value);
  return { ...list, favorites: has ? list.favorites.filter((v) => v !== value) : [value, ...list.favorites].slice(0, MAX_FAVORITES) };
}

/**
 * What the shortlist shows: favourites first, then recents that are not already favourites, both limited to models
 * that still exist (a removed provider or model silently drops out; the stored value is kept for if it returns).
 */
export function shortlistOptions<T extends { value: string }>(list: ModelShortlist, options: readonly T[]): { favorites: T[]; recent: T[] } {
  const byValue = new Map(options.map((o) => [o.value, o]));
  const favorites = list.favorites.map((v) => byValue.get(v)).filter((o): o is T => !!o);
  const recent = list.recent.filter((v) => !list.favorites.includes(v)).map((v) => byValue.get(v)).filter((o): o is T => !!o);
  return { favorites, recent };
}
