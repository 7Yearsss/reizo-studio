export interface SavedViewport { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 3;

/** A stored canvas viewport, or null when absent / malformed. Zoom is clamped to the range the canvas allows. */
export function parseSavedViewport(raw: string | null | undefined): SavedViewport | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SavedViewport> | null;
    if (!v || ![v.x, v.y, v.zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) || (v.zoom as number) <= 0) return null;
    return { x: v.x as number, y: v.y as number, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom as number)) };
  } catch {
    return null;
  }
}
