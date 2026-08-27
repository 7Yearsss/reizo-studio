import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type ChatState } from './chatStore';

export function useChatStore<T>(selector: (state: ChatState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
