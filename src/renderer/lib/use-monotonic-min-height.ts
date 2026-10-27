import { useEffect, useRef, type RefObject } from 'react';

/**
 * While `active`, remember the tallest the element has been and hold it at least that tall, so a live steps area that
 * briefly shrinks (a row collapses, a thinking block is replaced by a tool row) does not pull everything below it
 * upward. Released when the work ends, and the moment the user clicks or presses a key inside it, so their own
 * collapse/expand is never fought. Writes the style directly: no re-render per frame.
 */
export function useMonotonicMinHeight<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!active || typeof ResizeObserver === 'undefined') {
      el.style.minHeight = '';
      return undefined;
    }
    let tallest = 0;
    const observer = new ResizeObserver(() => {
      const height = el.offsetHeight;
      if (height > tallest) {
        tallest = height;
        el.style.minHeight = `${tallest}px`;
      }
    });
    observer.observe(el);
    const release = (): void => { tallest = 0; el.style.minHeight = ''; };
    el.addEventListener('pointerdown', release);
    el.addEventListener('keydown', release);
    return () => {
      observer.disconnect();
      el.removeEventListener('pointerdown', release);
      el.removeEventListener('keydown', release);
      el.style.minHeight = '';
    };
  }, [active]);
  return ref;
}
