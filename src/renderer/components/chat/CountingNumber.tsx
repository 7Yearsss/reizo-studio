import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Total budget time in ms to finish counting up to the new value */
export const COUNT_UP_MS = 400;

/** Tick interval in ms */
export const COUNT_UP_TICK_MS = 55;

/** Jitter range: 60% to 140% of base step */
export const JITTER_MIN = 0.6;
export const JITTER_SPAN = 0.8;

/**
 * Calculates adaptive, jittered step size so the count feels organic
 * while strictly guaranteeing it never overshoots the target.
 */
export function countUpStep(remaining: number, stepsLeft: number, jitter: number): number {
  if (remaining <= 0) return 0;
  if (stepsLeft <= 1) return remaining;
  const base = remaining / stepsLeft;
  const stepped = Math.round(base * (JITTER_MIN + jitter * JITTER_SPAN));
  return Math.min(Math.max(stepped, 1), remaining);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Hook that smoothly counts an integer up to `target`.
 * If target decreases or reduced-motion is preferred, it settles immediately.
 */
export function useCountingUp(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (shownRef.current === target) return undefined;
    if (shownRef.current > target || prefersReducedMotion()) {
      setShown(target);
      return undefined;
    }

    let stepsLeft = Math.max(1, Math.round(COUNT_UP_MS / COUNT_UP_TICK_MS));
    const timer = setInterval(() => {
      const remaining = target - shownRef.current;
      const step = countUpStep(remaining, stepsLeft, Math.random());
      stepsLeft -= 1;
      const next = shownRef.current + step;
      shownRef.current = next;
      setShown(next);
      if (next >= target) clearInterval(timer);
    }, COUNT_UP_TICK_MS);

    return () => clearInterval(timer);
  }, [target]);

  return shown;
}

export interface CountingNumberProps {
  value: number;
  render?: (shown: number) => ReactNode;
  className?: string;
}

/**
 * Renders an animated number that smoothly counts up when the target value increases,
 * providing a living, streaming data feel.
 */
export function CountingNumber({ value, render, className }: CountingNumberProps) {
  const shown = useCountingUp(value);
  if (render) {
    return <span className={className}>{render(shown)}</span>;
  }
  return <span className={className}>{shown}</span>;
}

export default CountingNumber;
