import { describe, it, expect } from 'vitest';
import { calculateSmartGuides, type NodeRect } from './smartGuides';

describe('calculateSmartGuides', () => {
  const targetA: NodeRect = {
    id: 'target-a',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
  };

  it('snaps to center-to-center X axis (vertical guide line)', () => {
    // targetA center X is 100 + 200/2 = 200
    // dragged node has width 100, so center is x + 50.
    // When dragged.x = 152, center is 202 (2px away from 200, well within 8px threshold)
    const dragged: NodeRect = {
      id: 'dragged',
      x: 152,
      y: 400,
      width: 100,
      height: 100,
    };

    const result = calculateSmartGuides(dragged, [targetA], 1);
    // Should snap so dragged center X is 200 -> dragged.x = 200 - 50 = 150
    expect(result.snappedPosition.x).toBe(150);
    expect(result.vertical).not.toBeNull();
    expect(result.vertical?.pos).toBe(200);
    expect(result.vertical?.alignment).toBe('center');
    expect(result.vertical?.centerPoints).toHaveLength(2);
    expect(result.vertical?.centerPoints).toContainEqual({ x: 200, y: 150 }); // targetA center (100 + 100/2 = 150)
    expect(result.vertical?.centerPoints).toContainEqual({ x: 200, y: 450 }); // dragged center (400 + 100/2 = 450)
  });

  it('snaps to center-to-center Y axis (horizontal guide line)', () => {
    // targetA center Y is 100 + 100/2 = 150
    // dragged node has height 100, so center is y + 50.
    // When dragged.y = 97, center is 147 (3px away from 150)
    const dragged: NodeRect = {
      id: 'dragged',
      x: 500,
      y: 97,
      width: 100,
      height: 100,
    };

    const result = calculateSmartGuides(dragged, [targetA], 1);
    // Should snap so dragged center Y is 150 -> dragged.y = 150 - 50 = 100
    expect(result.snappedPosition.y).toBe(100);
    expect(result.horizontal).not.toBeNull();
    expect(result.horizontal?.pos).toBe(150);
    expect(result.horizontal?.alignment).toBe('center');
    expect(result.horizontal?.centerPoints).toHaveLength(2);
  });

  it('snaps to left-to-left edge alignment', () => {
    // targetA left is 100
    // dragged node left is 103 (3px away)
    // centers are far apart: target centerX=200, dragged width=300 -> dragged centerX=253 (diff=53 > 8)
    const dragged: NodeRect = {
      id: 'dragged',
      x: 103,
      y: 500,
      width: 300,
      height: 100,
    };

    const result = calculateSmartGuides(dragged, [targetA], 1);
    expect(result.snappedPosition.x).toBe(100);
    expect(result.vertical).not.toBeNull();
    expect(result.vertical?.pos).toBe(100);
    expect(result.vertical?.alignment).toBe('edge');
    expect(result.vertical?.centerPoints).toBeUndefined();
  });

  it('snaps to top-to-top edge alignment', () => {
    const dragged: NodeRect = {
      id: 'dragged',
      x: 500,
      y: 102,
      width: 300,
      height: 300,
    };

    const result = calculateSmartGuides(dragged, [targetA], 1);
    expect(result.snappedPosition.y).toBe(100);
    expect(result.horizontal).not.toBeNull();
    expect(result.horizontal?.pos).toBe(100);
    expect(result.horizontal?.alignment).toBe('edge');
  });

  it('does not snap if outside threshold', () => {
    // 30px away, outside default 8px threshold
    const dragged: NodeRect = {
      id: 'dragged',
      x: 130,
      y: 400,
      width: 100,
      height: 100,
    };

    const result = calculateSmartGuides(dragged, [targetA], 1);
    expect(result.snappedPosition.x).toBe(130);
    expect(result.snappedPosition.y).toBe(400);
    expect(result.vertical).toBeNull();
    expect(result.horizontal).toBeNull();
  });

  it('ignores section nodes', () => {
    const sectionNode: NodeRect = {
      id: 'sec-1',
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      type: 'section',
    };

    const dragged: NodeRect = {
      id: 'dragged',
      x: 498, // center=548, close to section center=500
      y: 400,
      width: 100,
      height: 100,
    };

    const result = calculateSmartGuides(dragged, [sectionNode], 1);
    expect(result.vertical).toBeNull();
    expect(result.horizontal).toBeNull();
  });

  it('adapts threshold according to zoom level', () => {
    // At zoom = 0.5, screen 8px threshold corresponds to 16px in canvas coordinates!
    // Distance of 12px should snap at zoom=0.5, but not at zoom=1.0.
    const dragged: NodeRect = {
      id: 'dragged',
      x: 100 + 12, // 12px away from left-to-left alignment
      y: 500,
      width: 300,
      height: 100,
    };

    const resultNormal = calculateSmartGuides(dragged, [targetA], 1.0);
    expect(resultNormal.vertical).toBeNull(); // 12 > 8, no snap

    const resultZoomedOut = calculateSmartGuides(dragged, [targetA], 0.5);
    expect(resultZoomedOut.vertical).not.toBeNull(); // 12 <= 16, snapped!
    expect(resultZoomedOut.snappedPosition.x).toBe(100);
  });
});
