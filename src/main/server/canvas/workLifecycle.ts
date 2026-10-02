import type { CanvasStore } from '../storage/canvasStore';

const controllers = new WeakMap<CanvasStore, AbortController>();

export function canvasWorkSignal(store: CanvasStore): AbortSignal {
  let controller = controllers.get(store);
  if (!controller) { controller = new AbortController(); controllers.set(store, controller); }
  return controller.signal;
}

export function canvasWorkStopped(store: CanvasStore): boolean {
  return canvasWorkSignal(store).aborted;
}

/** Revoke legacy executor callbacks before their repositories can be closed. */
export function stopCanvasWork(store: CanvasStore): void {
  canvasWorkSignal(store);
  controllers.get(store).abort('shutdown');
}
