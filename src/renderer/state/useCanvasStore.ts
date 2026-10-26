import { useRef, useSyncExternalStore } from 'react';
import type { CanvasNode } from '../../shared/canvas';
import { getSnapshot, subscribe, type CanvasState } from './canvasStore';

export function useCanvasStore<T>(selector: (state: CanvasState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}

const GEOMETRY_KEYS = new Set<string>(['x', 'y', 'w', 'h']);

/** Live drags only rewrite x/y/w/h; every other field keeps its reference. */
export function sameNodeIgnoringGeometry(a: CanvasNode | undefined, b: CanvasNode | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a) as Array<keyof CanvasNode>;
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => GEOMETRY_KEYS.has(key) || a[key] === b[key]);
}

export function sameNodesIgnoringGeometry(a: readonly CanvasNode[] | undefined, b: readonly CanvasNode[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((node, index) => sameNodeIgnoringGeometry(node, b[index]));
}

/** Like `useCanvasStore`, but keeps the previous value while `isEqual` says nothing relevant changed. */
export function useCanvasStoreEq<T>(selector: (state: CanvasState) => T, isEqual: (previous: T, next: T) => boolean): T {
  const cache = useRef<{ value: T } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const next = selector(getSnapshot());
    if (cache.current && isEqual(cache.current.value, next)) return cache.current.value;
    cache.current = { value: next };
    return next;
  });
}
