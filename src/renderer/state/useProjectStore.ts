import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type ProjectState } from './projectStore';

export function useProjectStore<T>(selector: (state: ProjectState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
