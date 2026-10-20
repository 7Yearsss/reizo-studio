/**
 * Data-layer typewriter. The stream delivers text in uneven bursts; this
 * reveals it into session state on a steady clock at a rate that self-matches
 * the backlog, so the bubble grows smoothly instead of lurching. It lives in
 * the data layer (not a view-layer effect) so the same value drives render,
 * autoscroll and future virtualization measurement off one clock.
 */

const TAU = 0.32; // steady-state trailing delay for large bursts, seconds
const MIN_CPS = 8; // floor velocity
/** 50fps smooth clock (~20ms per frame) to eliminate chunky 50ms block drops. */
export const COMMIT_MS = 20;
/** Simulated window for first paint synchronous slice. */
const FIRST_PAINT_BURST_MS = 50;

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

/**
 * Calculates adaptive target speed (chars/sec) from the current backlog.
 * Smoothly scales from a gentle trickle during small backlogs (to bridge network gaps
 * without starving) up to high-speed catch-up when a large code/text chunk arrives.
 */
function getTargetCps(backlog: number): number {
  if (backlog <= 0) return 0;
  if (backlog <= 6) {
    // Gentle trickle to bridge network gaps smoothly without starving: ~24-36 chars/sec
    return 24 + backlog * 2;
  }
  if (backlog <= 24) {
    // Fluid, comfortable reading speed: ~36-72 chars/sec
    return 36 + (backlog - 6) * 2;
  }
  if (backlog <= 60) {
    // Brisk pace: ~72-162 chars/sec
    return 72 + (backlog - 24) * 2.5;
  }
  // Large backlog (e.g. big code snippet): scale up aggressively to avoid lag
  return Math.max(162, backlog / TAU);
}

export function createRevealController(commit: (revealed: string) => void): RevealController {
  let target = '';
  let shown = 0;
  let fraction = 0;
  let currentCps = 0;
  let lastTickTime = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    lastTickTime = 0;
  };

  const tick = (isFirstPaint = false) => {
    const backlog = target.length - shown;
    if (backlog <= 0) {
      stop();
      return;
    }

    const targetCps = Math.max(MIN_CPS, getTargetCps(backlog));
    const now = Date.now();
    const dtMs = isFirstPaint
      ? FIRST_PAINT_BURST_MS
      : lastTickTime > 0
        ? Math.max(1, Math.min(now - lastTickTime, 100))
        : COMMIT_MS;
    lastTickTime = now;

    // Fluid inertia: smooth out speed changes so velocity never steps or jerks
    const smoothing = isFirstPaint ? 1 : Math.min(1, (dtMs / 1000) * 12);
    currentCps = currentCps === 0 ? targetCps : currentCps + (targetCps - currentCps) * smoothing;

    fraction += (currentCps * dtMs) / 1000;
    let advance = Math.floor(fraction);

    // If backlog exists, guarantee forward motion of at least 1 unit when interval elapsed
    if (advance < 1 && (isFirstPaint || fraction >= 0.75)) {
      advance = 1;
    }

    if (advance > 0) {
      fraction = Math.max(0, fraction - advance);
      let next = Math.min(target.length, shown + advance);

      // Don't cut a surrogate pair: back off one unit, or push forward past
      // the whole pair if backing off would make no progress.
      if (next < target.length && isHighSurrogate(target.charCodeAt(next - 1))) {
        next = next - 1 > shown ? next - 1 : Math.min(target.length, next + 1);
      }

      if (next > shown) {
        shown = next;
        commit(target.slice(0, shown));
      }
    }

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
      if (shown === 0) tick(true);
      if (timer === null && shown < target.length) {
        lastTickTime = Date.now();
        timer = setInterval(() => tick(false), COMMIT_MS);
      }
    },
    flush() {
      stop();
      shown = target.length;
      fraction = 0;
      currentCps = 0;
      commit(target);
    },
    reset() {
      stop();
      target = '';
      shown = 0;
      fraction = 0;
      currentCps = 0;
    },
  };
}
