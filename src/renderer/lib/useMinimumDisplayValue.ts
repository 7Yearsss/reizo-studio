import { useEffect, useRef, useState } from 'react';

/** Hold each changed value on screen for at least `minMs` so fast streams stay readable. */
export function useMinimumDisplayValue<T>(value: T, minMs: number): T {
  const [shown, setShown] = useState(value);
  const shownAt = useRef(Date.now());
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (Object.is(value, shown)) return;
    const wait = Math.max(0, shownAt.current + minMs - Date.now());
    const id = window.setTimeout(() => {
      shownAt.current = Date.now();
      setShown(latest.current);
    }, wait);
    return () => window.clearTimeout(id);
  }, [value, shown, minMs]);

  return shown;
}
