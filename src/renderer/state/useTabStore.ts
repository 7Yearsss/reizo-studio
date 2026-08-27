import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type TabState } from './tabStore';

export function useTabStore<T>(selector: (state: TabState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
