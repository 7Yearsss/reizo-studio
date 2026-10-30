import { useSyncExternalStore } from 'react';
import {
  resolveKeys,
  sanitizeOverrides,
  validateBinding,
  type BindingCheck,
  type RebindableId,
  type ShortcutOverrides,
} from '../../shared/shortcutBindings';

const STORAGE_KEY = 'reizo:shortcut-overrides';

function load(): ShortcutOverrides {
  try {
    return sanitizeOverrides(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return {};
  }
}

let overrides: ShortcutOverrides = load();
const listeners = new Set<() => void>();

function commit(next: ShortcutOverrides): void {
  overrides = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the override lasts for this run */
  }
  for (const l of listeners) l();
}

export const shortcutStore = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: (): ShortcutOverrides => overrides,
  keysFor: (id: RebindableId): string => resolveKeys(id, overrides),
  set(id: RebindableId, keys: string): BindingCheck {
    const check = validateBinding(id, keys, overrides);
    if (check.ok) commit({ ...overrides, [id]: keys });
    return check;
  },
  reset(id: RebindableId): void {
    const rest = { ...overrides };
    delete rest[id];
    commit(rest);
  },
  /** While a binding is being recorded, global shortcuts stand down so the new combination is not also executed. */
  recording: false,
};

export function useShortcutOverrides(): ShortcutOverrides {
  return useSyncExternalStore(shortcutStore.subscribe, shortcutStore.getSnapshot);
}
