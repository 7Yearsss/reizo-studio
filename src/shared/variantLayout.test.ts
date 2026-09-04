import { describe, expect, it } from 'vitest';
import { variantGrid, type Box } from './variantLayout';

const src: Box = { x: 0, y: 0, w: 100, h: 100 };

describe('variantGrid', () => {
  it('returns [] for count <= 0', () => {
    expect(variantGrid(src, 0, [src])).toEqual([]);
    expect(variantGrid(src, -3, [src])).toEqual([]);
  });

  it('lays count=4 as a 2×2 block to the right of the source', () => {
    const pos = variantGrid(src, 4, [src], { gapX: 32, gapY: 32 });
    // origin x = source.x + w + gap = 132; column step = cellW + gapX = 132
    expect(pos).toEqual([
      { x: 132, y: 0 },
      { x: 264, y: 0 },
      { x: 132, y: 132 },
      { x: 264, y: 132 },
    ]);
  });

  it('honours a custom column count', () => {
    const pos = variantGrid(src, 3, [src], { cols: 3, gapX: 10, gapY: 10 });
    expect(pos).toEqual([
      { x: 110, y: 0 },
      { x: 220, y: 0 },
      { x: 330, y: 0 },
    ]);
  });

  it('nudges the block down when the default slot is occupied', () => {
    const blocker: Box = { x: 110, y: -20, w: 300, h: 80 }; // covers the first row
    const pos = variantGrid(src, 2, [src, blocker], { cols: 2, gapX: 10, gapY: 10 });
    // first row (y:0) collides -> step down by cellH+gapY = 110
    expect(pos.every((p) => p.y >= 110)).toBe(true);
    expect(pos).toEqual([
      { x: 110, y: 110 },
      { x: 220, y: 110 },
    ]);
  });

  it('never overlaps any occupied box for a realistic crowded canvas', () => {
    const occupied: Box[] = [
      src,
      { x: 132, y: 0, w: 100, h: 100 },
      { x: 132, y: 132, w: 100, h: 100 },
      { x: 264, y: 0, w: 100, h: 400 },
    ];
    const pos = variantGrid(src, 4, occupied);
    const cells = pos.map((p) => ({ x: p.x, y: p.y, w: src.w, h: src.h }));
    for (const c of cells) {
      for (const o of occupied) {
        const overlap =
          c.x < o.x + o.w && c.x + c.w > o.x && c.y < o.y + o.h && c.y + c.h > o.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it('respects a non-default source size', () => {
    const big: Box = { x: 10, y: 10, w: 340, h: 420 };
    const pos = variantGrid(big, 2, [big], { cols: 2, gapX: 20, gapY: 20 });
    expect(pos).toEqual([
      { x: 370, y: 10 },
      { x: 730, y: 10 },
    ]);
  });
});
