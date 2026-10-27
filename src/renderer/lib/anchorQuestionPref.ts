import { useSyncExternalStore } from 'react';

const KEY = 'reizo.anchorQuestion';
const listeners = new Set<() => void>();

/** Per-viewer preference: keep my question at the top while a long reply streams, instead of following the end. */
export function getAnchorQuestion(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setAnchorQuestion(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* per-viewer convenience */ }
  listeners.forEach((fn) => fn());
}

export function useAnchorQuestion(): boolean {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getAnchorQuestion, () => false);
}
