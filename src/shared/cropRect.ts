export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** The smallest selection (in image pixels) that counts as a deliberate crop rather than a stray click. */
export const MIN_CROP_PX = 12;

/** The rectangle spanned by two corners, whichever way the user dragged. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * A selection made on the scaled-down picture on screen, turned into pixels of the real image and kept inside it.
 * Null when it is too small to be meant.
 */
export function toImageRect(selection: Rect, shown: { width: number; height: number }, natural: { width: number; height: number }): Rect | null {
  if (shown.width <= 0 || shown.height <= 0) return null;
  const sx = natural.width / shown.width;
  const sy = natural.height / shown.height;
  const x = Math.max(0, Math.round(selection.x * sx));
  const y = Math.max(0, Math.round(selection.y * sy));
  const right = Math.min(natural.width, Math.round((selection.x + selection.width) * sx));
  const bottom = Math.min(natural.height, Math.round((selection.y + selection.height) * sy));
  const width = right - x;
  const height = bottom - y;
  return width >= MIN_CROP_PX && height >= MIN_CROP_PX ? { x, y, width, height } : null;
}
