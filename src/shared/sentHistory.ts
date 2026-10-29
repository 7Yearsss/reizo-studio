export interface HistoryStep {
  /** 0 = most recent sent message; null = back at the live draft. */
  cursor: number | null;
  /** Text to place in the composer; null leaves the draft untouched. */
  text: string | null;
}

/** ↑/↓ through previously sent messages. History is oldest-first; empty or blank entries are skipped. */
export function historyStep(history: string[], cursor: number | null, direction: 'up' | 'down'): HistoryStep {
  const items = history.filter((text) => text.trim());
  if (items.length === 0) return { cursor, text: null };
  if (direction === 'up') {
    const next = cursor === null ? 0 : Math.min(cursor + 1, items.length - 1);
    return { cursor: next, text: items[items.length - 1 - next] };
  }
  if (cursor === null) return { cursor: null, text: null };
  if (cursor === 0) return { cursor: null, text: '' };
  return { cursor: cursor - 1, text: items[items.length - cursor] };
}
