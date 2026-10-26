export const MAX_QUICK_ASK_CHARS = 20_000;

/** The text a quick-assistant submit may carry: a string with something in it, trimmed and capped. */
export function normalizeQuickAsk(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, MAX_QUICK_ASK_CHARS) : null;
}

/** The URL fragment that makes the renderer show the small floating window instead of the whole app. */
export const QUICK_WINDOW_HASH = 'quick';

export function isQuickWindowHash(hash: string): boolean {
  return hash.replace(/^#/, '') === QUICK_WINDOW_HASH;
}

/** Where the floating window goes: horizontally centred on the display, in the upper third. */
export function quickWindowPosition(work: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }): { x: number; y: number } {
  return { x: Math.round(work.x + (work.width - size.width) / 2), y: Math.round(work.y + work.height * 0.22) };
}
