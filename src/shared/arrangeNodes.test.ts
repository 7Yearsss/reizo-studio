import { describe, expect, it } from 'vitest';
import { gridArrange } from './arrangeNodes';

describe('gridArrange', () => {
  it('returns unchanged position for a single node', () => {
    const single = [{ id: 'n1', x: 100, y: 200, w: 300, h: 200 }];
    const res = gridArrange(single);
    expect(res).toEqual({ n1: { x: 100, y: 200 } });
  });

  it('arranges 3 nodes horizontally with fixed gap and preserves center', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 300, y: 0, w: 100, h: 100 },
      { id: 'c', x: 600, y: 0, w: 100, h: 100 },
    ];
    // original bounds: minX=0, maxX=700 -> centerX=350, centerY=50
    const res = gridArrange(nodes, { gap: 20 });
    expect(res.a.y).toBe(res.b.y);
    expect(res.b.y).toBe(res.c.y);
    // distance between a and b: width (100) + gap (20) = 120
    expect(res.b.x - res.a.x).toBe(120);
    expect(res.c.x - res.b.x).toBe(120);

    // new bounds center:
    const newMinX = res.a.x;
    const newMaxX = res.c.x + 100;
    expect((newMinX + newMaxX) / 2).toBe(350);
  });

  it('arranges 4 nodes in a 2x2 grid', () => {
    const nodes = [
      { id: 'a', x: 10, y: 10, w: 100, h: 80 },
      { id: 'b', x: 150, y: 10, w: 100, h: 80 },
      { id: 'c', x: 10, y: 120, w: 100, h: 80 },
      { id: 'd', x: 150, y: 120, w: 100, h: 80 },
    ];
    const res = gridArrange(nodes, { gap: 10 });
    expect(res.a.y).toBe(res.b.y);
    expect(res.c.y).toBe(res.d.y);
    expect(res.c.y).toBeGreaterThan(res.a.y);
  });

  it('honors custom center option', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 200, y: 0, w: 100, h: 100 },
    ];
    const res = gridArrange(nodes, { gap: 20, center: { x: 500, y: 500 } });
    // total width = 100 + 20 + 100 = 220
    // startX = 500 - 110 = 390
    expect(res.a.x).toBe(390);
    expect(res.b.x).toBe(510);
    expect((res.a.x + res.b.x + 100) / 2).toBe(500);
  });
});
