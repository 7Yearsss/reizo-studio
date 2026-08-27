import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type SettingsState } from './settingsStore';

export function useSettingsStore<T>(selector: (state: SettingsState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
