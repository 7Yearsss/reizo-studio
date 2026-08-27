import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './skillStore';

export function useSkillStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
