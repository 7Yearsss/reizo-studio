export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;
/** A pointer move shorter than this is a click, not a pan. */
export const PAN_THRESHOLD_PX = 4;

export function clampZoom(scale: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(scale * 100) / 100));
}

/** One wheel notch zooms by a fixed step: scrolling up zooms in. */
export function zoomByWheel(scale: number, deltaY: number): number {
  if (deltaY === 0) return scale;
  return clampZoom(scale + (deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}

export interface Point { x: number; y: number }

/**
 * Pan offset after changing scale so the point under the cursor stays put.
 * `cursor` and `offset` are relative to the viewport centre, where the image is centred at offset 0.
 */
export function offsetForZoom(offset: Point, cursor: Point, from: number, to: number): Point {
  if (from === to || from === 0) return offset;
  const ratio = to / from;
  return { x: cursor.x - (cursor.x - offset.x) * ratio, y: cursor.y - (cursor.y - offset.y) * ratio };
}

export function exceedsPanThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > PAN_THRESHOLD_PX;
}
