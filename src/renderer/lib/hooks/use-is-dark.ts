import { useSyncExternalStore } from 'react';

/**
 * Tracks whether the app is in dark mode. `settingsStore.applyAppearance`
 * toggles a `.dark` class on `<html>` for both explicit and system themes, so
 * a `MutationObserver` on that attribute is the single source of truth.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
