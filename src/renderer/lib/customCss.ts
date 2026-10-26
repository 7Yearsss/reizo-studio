import { sanitizeCustomCss } from '../../shared/customCss';

const KEY = 'reizo:custom-css';
const STYLE_ID = 'reizo-user-css';

export function getStoredCustomCss(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

/**
 * Applies the user's CSS in an unlayered <style> placed last in <head>: the app's own styles live in cascade layers, so
 * unlayered rules win without !important. Returns what was removed during sanitising.
 */
export function applyCustomCss(css: string): string[] {
  const clean = sanitizeCustomCss(css);
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!clean.css) { el?.remove(); } else {
    if (!el) { el = document.createElement('style'); el.id = STYLE_ID; }
    el.textContent = clean.css;
    document.head.appendChild(el); // appendChild moves it to the end if it already exists
  }
  try { if (clean.css) localStorage.setItem(KEY, clean.css); else localStorage.removeItem(KEY); } catch { /* per-viewer convenience */ }
  return clean.removed;
}

export function applyStoredCustomCss(): void {
  const css = getStoredCustomCss();
  if (css) applyCustomCss(css);
}
