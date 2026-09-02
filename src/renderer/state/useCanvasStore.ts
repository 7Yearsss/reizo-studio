import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type CanvasState } from './canvasStore';

export function useCanvasStore<T>(selector: (state: CanvasState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
