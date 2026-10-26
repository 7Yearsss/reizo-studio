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
