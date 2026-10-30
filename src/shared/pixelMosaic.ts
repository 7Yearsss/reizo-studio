export interface MosaicGrid { cols: number; rows: number }
export type Rgb = [number, number, number];

/** A grid of roughly square cells of about `cell` px that covers w×h; at least 2×2, at most `maxCells` cells. */
export function mosaicGrid(w: number, h: number, cell = 14, maxCells = 900): MosaicGrid {
  let size = Math.max(4, cell);
  let cols = Math.max(2, Math.round(w / size));
  let rows = Math.max(2, Math.round(h / size));
  while (cols * rows > maxCells) {
    size *= 1.25;
    cols = Math.max(2, Math.round(w / size));
    rows = Math.max(2, Math.round(h / size));
  }
  return { cols, rows };
}

/** Average colour of each grid cell of an RGBA pixel buffer (row-major), so the loading mosaic wears the picture's own colours. */
export function sampleCellColors(rgba: ArrayLike<number>, w: number, h: number, grid: MosaicGrid): Rgb[] {
  const out: Rgb[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const y0 = Math.floor((r * h) / grid.rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / grid.rows));
    for (let c = 0; c < grid.cols; c++) {
      const x0 = Math.floor((c * w) / grid.cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / grid.cols));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const i = (y * w + x) * 4;
          if ((rgba[i + 3] ?? 255) === 0) continue;
          sr += rgba[i]; sg += rgba[i + 1]; sb += rgba[i + 2]; n++;
        }
      }
      out.push(n ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : [128, 128, 128]);
    }
  }
  return out;
}

/** Deterministic 0–1 generator so a cell's flicker phase is stable between frames. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-cell brightness over time: each cell breathes with its own phase and speed, between 0.35 and 1. */
export function cellAlpha(phase: number, speed: number, seconds: number): number {
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase + seconds * speed));
}
