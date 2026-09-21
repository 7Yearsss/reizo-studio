/**
 * Cheap cross-module "is a canvas drag/pan in flight" flag.
 *
 * The canvas root already exposes `data-dragging` for CSS, but JS animators
 * (e.g. the dither canvas loop in image-generation) need the same signal to
 * pause their per-frame painting while a gesture is in progress.
 */
let interacting = false;

export function setCanvasInteracting(value: boolean): void {
  interacting = value;
}

export function canvasInteracting(): boolean {
  return interacting;
}
