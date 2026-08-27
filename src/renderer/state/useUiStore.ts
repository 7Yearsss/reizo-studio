import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type UiState } from './uiStore';

export function useUiStore<T>(selector: (state: UiState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
