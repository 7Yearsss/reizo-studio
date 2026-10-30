export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** A freehand stroke in 0–1 coordinates relative to the image, so display and what is sent agree at any size. */
export type Stroke = Point[];

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
/** Points closer than this (fraction of the image) to the previous one are dropped. */
const MIN_STEP = 0.004;
const MAX_POINTS = 600;

export function pointFromClient(box: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): Point {
  return { x: clamp01((clientX - box.left) / box.width), y: clamp01((clientY - box.top) / box.height) };
}

/** Append a point unless it barely moved; a stroke stops growing at MAX_POINTS. */
export function extendStroke(stroke: Stroke, p: Point): Stroke {
  const last = stroke[stroke.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return stroke;
  if (stroke.length >= MAX_POINTS) return stroke;
  return [...stroke, p];
}

/** The box that covers every stroke plus `pad` on each side, kept inside the image; null when nothing was drawn. */
export function strokesBounds(strokes: readonly Stroke[], pad = 0.04): Rect | null {
  const pts = strokes.flat();
  if (pts.length === 0) return null;
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const x = clamp01(minX - pad);
  const y = clamp01(minY - pad);
  return { x, y, w: clamp01(maxX + pad) - x, h: clamp01(maxY + pad) - y };
}

/** Strokes re-expressed relative to `rect`, ready to draw on a crop of that region. */
export function strokesInRect(strokes: readonly Stroke[], rect: Rect): Stroke[] {
  return strokes.map((s) => s.map((p) => ({ x: (p.x - rect.x) / rect.w, y: (p.y - rect.y) / rect.h })));
}
