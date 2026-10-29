import { useEffect, type RefObject } from 'react';

const MAX_REMEMBERED = 200;
const positions = new Map<string, number>();

export function rememberScroll(key: string, top: number): void {
  if (top <= 0) { positions.delete(key); return; }
  positions.delete(key);
  positions.set(key, Math.round(top));
  if (positions.size > MAX_REMEMBERED) {
    const oldest = positions.keys().next().value;
    if (oldest !== undefined) positions.delete(oldest);
  }
}

export function recalledScroll(key: string): number {
  return positions.get(key) ?? 0;
}

export function resetScrollMemoryForTest(): void {
  positions.clear();
}

/** Keep a scroller's position across unmounts (tab or panel switches) for the same `key`. */
export function useScrollMemory(ref: RefObject<HTMLElement | null>, key: string): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = recalledScroll(key);
    // Content may still be laying out; retry for a few frames until it is tall enough.
    let frames = 0;
    let raf = 0;
    const restore = () => {
      if (!target) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) > 2 && frames++ < 20) raf = requestAnimationFrame(restore);
    };
    restore();
    const onScroll = () => rememberScroll(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, [ref, key]);
}
