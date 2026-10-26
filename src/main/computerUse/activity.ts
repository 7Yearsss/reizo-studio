/**
 * Is any computer-use task driving the machine right now? "Driving" starts at an acting step and ends when
 * no further step has come for `idleMs`, so the on-screen stop button appears while the agent works and
 * goes away once it has finished — not for the whole life of a cached controller.
 */
export function createActivityTracker(idleMs = 8_000) {
  const holders = new Map<object, ReturnType<typeof setTimeout>>();
  const listeners = new Set<(busy: boolean) => void>();
  const busy = () => holders.size > 0;
  const emit = () => { for (const listener of listeners) listener(busy()); };
  return {
    /** An acting step from `holder` is about to run. */
    touch(holder: object) {
      const was = busy();
      const previous = holders.get(holder);
      if (previous) clearTimeout(previous);
      const timer = setTimeout(() => { holders.delete(holder); if (!busy()) emit(); }, idleMs);
      timer.unref?.();
      holders.set(holder, timer);
      if (!was) emit();
    },
    /** The holder is gone (controller disposed or stopped). */
    release(holder: object) {
      const timer = holders.get(holder);
      if (timer) clearTimeout(timer);
      if (holders.delete(holder) && !busy()) emit();
    },
    subscribe(listener: (busy: boolean) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get busy() { return busy(); },
  };
}

export const computerActivity = createActivityTracker();
