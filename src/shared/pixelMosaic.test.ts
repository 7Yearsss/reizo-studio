import { describe, expect, it } from 'vitest';
import { cellAlpha, mosaicGrid, sampleCellColors, seededRandom } from './pixelMosaic';

describe('pixel mosaic', () => {
  it('picks a grid of about the cell size and respects the cell cap', () => {
    expect(mosaicGrid(280, 140, 14)).toEqual({ cols: 20, rows: 10 });
    const big = mosaicGrid(4000, 4000, 14, 900);
    expect(big.cols * big.rows).toBeLessThanOrEqual(900);
    expect(mosaicGrid(1, 1)).toEqual({ cols: 2, rows: 2 });
  });

  it('averages each cell of the picture', () => {
    // 2×2 picture: red, green / blue, white — sampled onto a 2×2 grid gives each pixel back.
    const px = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
    expect(sampleCellColors(px, 2, 2, { cols: 2, rows: 2 })).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]);
    // One cell over the whole picture is the mean.
    expect(sampleCellColors(px, 2, 2, { cols: 1, rows: 1 })).toEqual([[128, 128, 128]]);
  });

  it('ignores transparent pixels and falls back to grey', () => {
    expect(sampleCellColors([10, 20, 30, 0], 1, 1, { cols: 1, rows: 1 })).toEqual([[128, 128, 128]]);
  });

  it('is deterministic and bounded', () => {
    const a = seededRandom(7), b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    for (let s = 0; s < 50; s++) {
      const v = cellAlpha(1.3, 2, s * 0.37);
      expect(v).toBeGreaterThanOrEqual(0.35);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
