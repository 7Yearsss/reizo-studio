import { describe, expect, it } from 'vitest';
import { extendStroke, pointFromClient, strokesBounds, strokesInRect } from './strokes';

describe('strokes', () => {
  it('maps client coordinates into 0–1 and clamps', () => {
    const box = { left: 100, top: 50, width: 200, height: 100 };
    expect(pointFromClient(box, 200, 100)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointFromClient(box, 0, 999)).toEqual({ x: 0, y: 1 });
  });

  it('drops points that barely moved and caps the length', () => {
    let s = extendStroke([], { x: 0.1, y: 0.1 });
    s = extendStroke(s, { x: 0.1005, y: 0.1 });
    expect(s).toHaveLength(1);
    for (let i = 0; i < 1000; i++) s = extendStroke(s, { x: 0.1 + i * 0.0008, y: 0.2 });
    expect(s.length).toBeLessThanOrEqual(600);
  });

  it('bounds all strokes with padding inside the image', () => {
    expect(strokesBounds([])).toBeNull();
    const b = strokesBounds([[{ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.6 }], [{ x: 0.02, y: 0.9 }]], 0.05)!;
    expect(b.x).toBe(0);
    expect(b.y).toBeCloseTo(0.45);
    expect(b.x + b.w).toBeCloseTo(0.75);
    expect(b.y + b.h).toBeCloseTo(0.95);
  });

  it('re-expresses strokes relative to the crop', () => {
    const rect = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    expect(strokesInRect([[{ x: 0.75, y: 1 }]], rect)).toEqual([[{ x: 0.5, y: 1 }]]);
  });
});
