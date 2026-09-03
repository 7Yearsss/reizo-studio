/**
 * Grid placement for "fork N variations" — lay `count` same-size cells to the
 * right of a source node, then shove the whole block down (and, failing that,
 * right) until it overlaps nothing already on the canvas.
 *
 * Pure + deterministic (no time, no random) so it is unit-testable.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VariantGridOpts {
  /** Columns before wrapping to a new row. Default 2 (a 2×2 for count=4). */
  cols?: number;
  gapX?: number;
  gapY?: number;
  /** Safety cap on how many times the block is nudged. Default 64. */
  maxAttempts?: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * @param source   the node being forked (its box)
 * @param count    how many variant cells to place
 * @param occupied every box already on the canvas (usually incl. `source`)
 * @returns top-left corners, row-major, length === `count`
 */
export function variantGrid(
  source: Box,
  count: number,
  occupied: Box[],
  opts: VariantGridOpts = {},
): Array<{ x: number; y: number }> {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];

  const cols = Math.max(1, Math.floor(opts.cols ?? 2));
  const gapX = opts.gapX ?? 32;
  const gapY = opts.gapY ?? 32;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 64);
  const cellW = source.w;
  const cellH = source.h;
  const stepX = cellW + gapX;
  const stepY = cellH + gapY;

  const baseX = source.x + source.w + gapX;
  const baseY = source.y;

  const layout = (ox: number, oy: number): Array<{ x: number; y: number }> =>
    Array.from({ length: n }, (_, i) => ({
      x: ox + (i % cols) * stepX,
      y: oy + Math.floor(i / cols) * stepY,
    }));

  const collides = (positions: Array<{ x: number; y: number }>): boolean =>
    positions.some((p) =>
      occupied.some((o) => intersects({ x: p.x, y: p.y, w: cellW, h: cellH }, o)),
    );

  let originX = baseX;
  let originY = baseY;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const positions = layout(originX, originY);
    if (!collides(positions)) return positions;
    // Mostly step down; every 4th attempt jump a column right and reset Y.
    if (attempt % 4 === 3) {
      originX += stepX;
      originY = baseY;
    } else {
      originY += stepY;
    }
  }
  return layout(originX, originY);
}
