import { useSyncExternalStore } from 'react';

type SlotKind = 'center' | 'right';

const slots: Record<SlotKind, HTMLDivElement | null> = { center: null, right: null };
const listeners = new Set<() => void>();

/** Called by CustomTitleBar ref callbacks — registers the portal target element. */
export function setTitleBarSlot(kind: SlotKind, el: HTMLDivElement | null) {
  if (slots[kind] === el) return;
  slots[kind] = el;
  listeners.forEach((l) => l());
}

/** Pages portal their contextual chrome (title, toolbars) into the title bar through these. */
export function useTitleBarSlot(kind: SlotKind) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => slots[kind],
  );
}
