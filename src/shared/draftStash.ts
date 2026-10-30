export interface StashEntry { id: string; text: string; at: number }

export const MAX_STASH = 10;

/** Put a draft on top of the stash. Blank text is ignored; the same text moves to the top instead of duplicating; the oldest fall off. */
export function pushStash(list: readonly StashEntry[], text: string, now: number, id: string): StashEntry[] {
  const clean = text.trim();
  if (!clean) return [...list];
  const rest = list.filter((e) => e.text.trim() !== clean);
  return [{ id, text, at: now }, ...rest].slice(0, MAX_STASH);
}

export function removeStash(list: readonly StashEntry[], id: string): StashEntry[] {
  return list.filter((e) => e.id !== id);
}

/** Stored entries, with anything malformed dropped. */
export function parseStash(raw: string | null): StashEntry[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((e): e is StashEntry => !!e && typeof e.id === 'string' && typeof e.text === 'string' && typeof e.at === 'number')
      .slice(0, MAX_STASH);
  } catch {
    return [];
  }
}

/** One line of a stashed draft for the list. */
export function stashPreview(text: string, max = 48): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
