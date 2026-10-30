import { useSyncExternalStore } from 'react';
import { nanoid } from 'nanoid';
import { parseStash, pushStash, removeStash, type StashEntry } from '../../shared/draftStash';

const KEY = 'reizo:draft-stash';
let entries: StashEntry[] = (() => { try { return parseStash(localStorage.getItem(KEY)); } catch { return []; } })();
const listeners = new Set<() => void>();

function commit(next: StashEntry[]): void {
  entries = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* per-viewer convenience */ }
  for (const l of listeners) l();
}

export const draftStash = {
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
  getSnapshot: (): StashEntry[] => entries,
  /** Shelve a draft; returns false for a blank one. */
  push(text: string): boolean {
    if (!text.trim()) return false;
    commit(pushStash(entries, text, Date.now(), nanoid()));
    return true;
  },
  remove(id: string): void { commit(removeStash(entries, id)); },
};

export function useDraftStash(): StashEntry[] {
  return useSyncExternalStore(draftStash.subscribe, draftStash.getSnapshot);
}
