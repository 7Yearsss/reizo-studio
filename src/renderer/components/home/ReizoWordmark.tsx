import { useEffect, useRef, useState } from 'react';

const WORD = 'Reizo';
const LETTER_MS = 52;
const HOLD_MS = 420;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export default function ReizoWordmark({
  active,
  onSettled,
}: {
  active: boolean;
  onSettled?: () => void;
}) {
  const reduce = prefersReducedMotion();
  const [typed, setTyped] = useState(() => (reduce ? WORD.length : 0));
  const [caret, setCaret] = useState(() => !reduce);
  const settledRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    function settle() {
      if (settledRef.current) return;
      settledRef.current = true;
      setTyped(WORD.length);
      setCaret(false);
      onSettledRef.current?.();
    }

    if (reduce || !active) {
      settle();
      return;
    }

    if (typed < WORD.length) {
      const id = window.setTimeout(() => setTyped((n) => n + 1), LETTER_MS);
      return () => window.clearTimeout(id);
    }

    const id = window.setTimeout(settle, HOLD_MS);
    return () => window.clearTimeout(id);
  }, [typed, active, reduce]);

  return (
    <h1
      aria-label="Reizo"
      className="relative whitespace-nowrap text-[56px] font-semibold tracking-tight text-ink"
    >
      <span className="invisible" aria-hidden="true">
        {WORD}
      </span>
      <span className="absolute inset-0 inline-flex items-center whitespace-nowrap" aria-hidden="true">
        {WORD.slice(0, typed)}
        {caret && <span className="wordmark-caret" />}
      </span>
    </h1>
  );
}
