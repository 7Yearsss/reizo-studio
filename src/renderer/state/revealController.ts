/**
 * Data-layer typewriter. The stream delivers text in uneven bursts; this
 * reveals it into `streamingBySession` on a steady ~30fps clock at a rate
 * that self-matches the backlog, so the bubble grows smoothly instead of
 * lurching. It lives in the data layer (not a view-layer effect) so the same
 * value drives render, autoscroll and future virtualization measurement off
 * one clock.
 */

const TAU = 0.32; // steady-state trailing delay, seconds
const MIN_CPS = 8; // never slower than this
const COMMIT_MS = 33; // ~30fps commit throttle

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
  };

  return {
    push(fullText: string) {
      target = fullText;
      if (shown > target.length) shown = target.length;
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
