/**
 * Data-layer typewriter. The stream delivers text in uneven bursts; this
 * reveals it into session state on a steady clock at a rate that self-matches
 * the backlog, so the bubble grows smoothly instead of lurching. It lives in
 * the data layer (not a view-layer effect) so the same value drives render,
 * autoscroll and future virtualization measurement off one clock.
 */

const TAU = 0.32; // steady-state trailing delay, seconds
const MIN_CPS = 8; // never slower than this
/** ~20fps commit throttle — matches Vercel AI SDK `throttle: 50`. */
export const COMMIT_MS = 50;

export interface RevealController {
  /** New full accumulated text (monotonically growing). */
  push(fullText: string): void;
  /** Reveal everything immediately (turn terminal). */
  flush(): void;
  /** Stop the clock and clear. */
  reset(): void;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function createRevealController(commit: (revealed: string) => void): RevealController {
  let target = '';
  let shown = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = () => {
    const backlog = target.length - shown;
    if (backlog <= 0) {
      stop();
      return;
    }
    const cps = Math.max(backlog / TAU, MIN_CPS);
    const advance = Math.max(1, Math.round((cps * COMMIT_MS) / 1000));
    let next = Math.min(target.length, shown + advance);
    // Don't cut a surrogate pair: back off one unit, or push forward past
    // the whole pair if backing off would make no progress.
    if (next < target.length && isHighSurrogate(target.charCodeAt(next - 1))) {
      next = next - 1 > shown ? next - 1 : Math.min(target.length, next + 1);
    }
    if (next <= shown) return;
    shown = next;
    commit(target.slice(0, shown));
    if (shown >= target.length) stop();
  };

  return {
    push(fullText: string) {
      target = fullText;
      if (shown > target.length) shown = target.length;
      if (shown >= target.length) {
        stop();
        return;
      }
      // First paint only: later tokens coalesce on the interval so a burst of
      // 1-char deltas does not commit once per token.
      if (shown === 0) tick();
      if (timer === null && shown < target.length) {
        timer = setInterval(tick, COMMIT_MS);
      }
    },
    flush() {
      stop();
      shown = target.length;
      commit(target);
    },
    reset() {
      stop();
      target = '';
      shown = 0;
    },
  };
}
