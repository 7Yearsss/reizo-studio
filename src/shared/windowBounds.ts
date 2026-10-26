export interface Rect { x: number; y: number; width: number; height: number }

export interface SavedWindowState extends Rect {
  maximized?: boolean;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Parse whatever was on disk; anything malformed, zero-sized (Wayland reports 0x0) or absurd is rejected. */
export function parseSavedWindowState(raw: unknown): SavedWindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.x) || !finite(r.y) || !finite(r.width) || !finite(r.height)) return null;
  if (r.width <= 0 || r.height <= 0 || r.width > 20_000 || r.height > 20_000) return null;
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), maximized: r.maximized === true };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where to open the window. The saved size is clamped to the display it mostly sits on and must keep a usable part
 * (at least 25% of its area, and a strip of its title bar) on a connected display; otherwise the caller's default
 * size is centred on the primary display. That is what saves a window last seen on an unplugged monitor.
 */
export function resolveWindowBounds(
  saved: SavedWindowState | null,
  displays: Rect[],
  primary: Rect,
  fallback: { width: number; height: number },
  min: { width: number; height: number },
): { bounds: Rect; maximized: boolean } {
  const centred = (): Rect => {
    const width = Math.min(fallback.width, primary.width);
    const height = Math.min(fallback.height, primary.height);
    return { x: primary.x + Math.round((primary.width - width) / 2), y: primary.y + Math.round((primary.height - height) / 2), width, height };
  };
  if (!saved) return { bounds: centred(), maximized: false };
  const area = saved.width * saved.height;
  let best: Rect | null = null;
  let bestOverlap = 0;
  for (const display of displays) {
    const o = overlap(saved, display);
    if (o > bestOverlap) { best = display; bestOverlap = o; }
  }
  const titleStrip: Rect = { x: saved.x, y: saved.y, width: saved.width, height: 40 };
  if (!best || bestOverlap < area * 0.25 || overlap(titleStrip, best) === 0) return { bounds: centred(), maximized: false };
  const width = Math.max(min.width, Math.min(saved.width, best.width));
  const height = Math.max(min.height, Math.min(saved.height, best.height));
  const x = Math.min(Math.max(saved.x, best.x), best.x + best.width - width);
  const y = Math.min(Math.max(saved.y, best.y), best.y + best.height - height);
  return { bounds: { x, y, width, height }, maximized: saved.maximized === true };
}
