export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface ArrangeOptions {
  gap?: number;
  center?: { x: number; y: number };
}

/**
 * Arranges the given nodes into a compact aligned grid.
 * The overall center never shifts:
 *  - If options.center is provided, centers around that point (e.g. a group container's center).
 *  - Otherwise, centers around the current selection bounding-box center.
 */
export function gridArrange(
  nodes: LayoutNode[],
  options?: ArrangeOptions,
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  if (!nodes || nodes.length === 0) return result;

  for (const n of nodes) {
    result[n.id] = { x: n.x, y: n.y };
  }
  if (nodes.length < 2) return result;

  const gap = options?.gap ?? 48;

  // Sort nodes top-to-bottom, left-to-right (row-major)
  const sorted = [...nodes].sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > 40) return dy;
    return a.x - b.x;
  });

  const count = sorted.length;
  const cols = count <= 3 ? count : Math.ceil(Math.sqrt(count));
  const rows: LayoutNode[][] = [];
  for (let i = 0; i < count; i += cols) {
    rows.push(sorted.slice(i, i + cols));
  }

  const colWidths: number[] = Array(cols).fill(0);
  for (const row of rows) {
    row.forEach((n, ci) => {
      colWidths[ci] = Math.max(colWidths[ci], n.w ?? 320);
    });
  }

  const rowHeights = rows.map((row) =>
    Math.max(...row.map((n) => n.h ?? 240)),
  );

  const totalW = colWidths.reduce((sum, w) => sum + w, 0) + gap * (cols - 1);
  const totalH = rowHeights.reduce((sum, h) => sum + h, 0) + gap * (rows.length - 1);

  let centerX: number;
  let centerY: number;

  if (options?.center) {
    centerX = options.center.x;
    centerY = options.center.y;
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of sorted) {
      const w = n.w ?? 320;
      const h = n.h ?? 240;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    }
    centerX = (minX + maxX) / 2;
    centerY = (minY + maxY) / 2;
  }

  const startX = Math.round(centerX - totalW / 2);
  const startY = Math.round(centerY - totalH / 2);

  let currentY = startY;
  rows.forEach((row, ri) => {
    let currentX = startX;
    row.forEach((n, ci) => {
      result[n.id] = { x: currentX, y: currentY };
      currentX += colWidths[ci] + gap;
    });
    currentY += rowHeights[ri] + gap;
  });

  return result;
}
