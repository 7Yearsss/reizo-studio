export interface ShortcutKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/**
 * Mod+1..9 → tab index (9 means the last tab, as in browsers). Null when the
 * event is not a tab shortcut, is mid-IME-composition, or has no such tab.
 */
export function tabIndexForShortcut(e: ShortcutKeyEvent, tabCount: number): number | null {
  if (e.isComposing || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey) || tabCount <= 0) return null;
  const digit = /^Digit([1-9])$/.exec(e.code ?? '')?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : undefined);
  if (!digit) return null;
  const n = Number(digit);
  if (n === 9) return tabCount - 1;
  return n <= tabCount ? n - 1 : null;
}

/** The digit shown on tab `index` while the modifier is held: 1–8 for the first eight, 9 for the last tab (never both). */
export function shortcutDigitForTab(index: number, tabCount: number): number | null {
  if (index === tabCount - 1 && tabCount > 8) return 9;
  return index < 8 ? index + 1 : null;
}

/** How long the modifier must be held before the numbers appear, so a quick Ctrl+C never flashes them. */
export const SHORTCUT_HINT_DELAY_MS = 400;
