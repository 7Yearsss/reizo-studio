export const ESCAPE_STOP_WINDOW_MS = 1500;

/** Two Esc presses within the window stop a live turn; the first only arms it. */
export function escapeStopStep(armedAt: number | null, now: number, windowMs = ESCAPE_STOP_WINDOW_MS): { armedAt: number | null; stop: boolean } {
  if (armedAt !== null && now - armedAt <= windowMs) return { armedAt: null, stop: true };
  return { armedAt: now, stop: false };
}
