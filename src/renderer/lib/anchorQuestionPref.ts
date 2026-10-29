import { useSyncExternalStore } from 'react';

const KEY = 'reizo.anchorQuestion';
const listeners = new Set<() => void>();

/**
 * Per-viewer preference: keep my question at the top while a long reply streams, instead of following the end.
 * On unless the viewer switched it off ('0'); a short reply still follows to the end either way.
 */
export function getAnchorQuestion(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function setAnchorQuestion(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* per-viewer convenience */ }
  listeners.forEach((fn) => fn());
}

export function useAnchorQuestion(): boolean {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getAnchorQuestion, () => true);
}
