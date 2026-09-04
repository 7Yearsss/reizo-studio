import { useSyncExternalStore } from 'react';
import type { SidebarMode } from './uiStore';
import * as uiStore from './uiStore';
import * as tabStore from './tabStore';

export interface NavLocation {
  mode: SidebarMode;
  tabId?: string;
}

export interface NavHistoryState {
  canGoBack: boolean;
  canGoForward: boolean;
}

const history: NavLocation[] = [];
let cursor = -1;
let isNavigating = false;

// Referentially stable snapshot for useSyncExternalStore
let cachedSnapshot: NavHistoryState = {
  canGoBack: false,
  canGoForward: false,
};

function updateSnapshot(): boolean {
  const canGoBack = cursor > 0;
  const canGoForward = cursor < history.length - 1;
  if (cachedSnapshot.canGoBack !== canGoBack || cachedSnapshot.canGoForward !== canGoForward) {
    cachedSnapshot = { canGoBack, canGoForward };
    return true;
  }
  return false;
}

const listeners = new Set<() => void>();

function notify(): void {
  const changed = updateSnapshot();
  if (changed) {
    listeners.forEach((fn) => fn());
  }
}

export function recordNav(point: NavLocation): void {
  if (isNavigating) return;
  const current = history[cursor];
  if (current && current.mode === point.mode && current.tabId === point.tabId) {
    return;
  }
  history.splice(cursor + 1);
  history.push({ ...point });
  cursor = history.length - 1;
  notify();
}

function applyLocation(loc: NavLocation | undefined): void {
  if (!loc) return;
  isNavigating = true;
  try {
    uiStore.setMode(loc.mode);
    if (loc.mode === 'chat' && loc.tabId) {
      tabStore.selectTab(loc.tabId);
    }
  } finally {
    setTimeout(() => {
      isNavigating = false;
    }, 50);
  }
}

export function goBack(): void {
  if (cursor <= 0) return;
  cursor -= 1;
  applyLocation(history[cursor]);
  notify();
}

export function goForward(): void {
  if (cursor >= history.length - 1) return;
  cursor += 1;
  applyLocation(history[cursor]);
  notify();
}

export function getNavHistoryState(): NavHistoryState {
  return cachedSnapshot;
}

export function subscribeNavHistory(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useNavHistory(): NavHistoryState {
  return useSyncExternalStore(subscribeNavHistory, getNavHistoryState);
}
