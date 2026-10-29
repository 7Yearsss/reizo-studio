export const SPLITTER_STEP = 24;

/**
 * New width for a right-docked panel's splitter key press: ← widens, → narrows (the handle sits on the
 * panel's left edge), Shift takes a 4× step, Home/End jump to the limits. Null when the key is not ours.
 */
export function splitterKeyWidth(width: number, key: string, shift: boolean, min: number, max: number): number | null {
  const step = shift ? SPLITTER_STEP * 4 : SPLITTER_STEP;
  let next: number;
  switch (key) {
    case 'ArrowLeft': next = width + step; break;
    case 'ArrowRight': next = width - step; break;
    case 'Home': next = min; break;
    case 'End': next = max; break;
    default: return null;
  }
  return Math.max(min, Math.min(max, next));
}
