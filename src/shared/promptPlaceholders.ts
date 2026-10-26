/** `${主题}`-style fill-in slots in a draft (skills prefill them; the user replaces each before sending). */
export const PLACEHOLDER_PATTERN = /\$\{[^${}\n]{1,40}\}/g;

export interface PlaceholderSpan { start: number; end: number; name: string }

export function findPlaceholders(text: string): PlaceholderSpan[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    name: m[0].slice(2, -1).trim(),
  }));
}

export function hasPlaceholders(text: string): boolean {
  return findPlaceholders(text).length > 0;
}

/** Index of the placeholder to jump to from `caret` (forward, or backward with `reverse`), wrapping around; -1 when none. */
export function nextPlaceholderIndex(spans: PlaceholderSpan[], caret: number, reverse = false): number {
  if (spans.length === 0) return -1;
  if (!reverse) {
    const i = spans.findIndex((s) => s.start >= caret);
    return i === -1 ? 0 : i;
  }
  for (let i = spans.length - 1; i >= 0; i--) if (spans[i].end <= caret - 0 && spans[i].start < caret) return i;
  return spans.length - 1;
}
