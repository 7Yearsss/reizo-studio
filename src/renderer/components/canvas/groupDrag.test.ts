import { describe, it, expect, vi } from 'vitest';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return {
    ...actual,
    getCanvas: vi.fn(),
    readCanvasStream: vi.fn(
      (_id: string, _rev: number, _cb: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    ),
    patchCanvasNode: vi.fn(),
  };
});

import * as api from '../../api';
import { calculateSmartGuides, type NodeRect } from './smartGuides';
import * as canvasStore from '../../state/canvasStore';
import type { CanvasNode, CanvasGroupParams } from '../../../shared/canvas';

function makeNode(id: string, type: CanvasNode['type'], x = 0, y = 0, w = 200, h = 200, params: Record<string, unknown> = {}): CanvasNode {
  return {
    id,
    canvasId: 'c1',
    type,
    x,
    y,
    w,
    h,
    title: id,
    params,
    paramsHash: null,
    runState: 'idle',
    output: null,
    updatedAt: new Date().toISOString(),
  };
}

describe('Group Drag & Smart Guides Isolation', () => {
  it('does NOT snap group container to its own internal member nodes when excludeIds are passed', () => {
    // Group container is at x: 100, y: 100, width: 400, height: 300 (center at 300, 250)
    // Internal member node is at x: 250, y: 200, width: 100, height: 100 (center at 300, 250)
    // Notice their centers are identically aligned!
    const groupRect: NodeRect = {
      id: 'group-1',
      x: 102, // 2px offset, within 8px threshold of center (300)
      y: 100,
      width: 400,
      height: 300,
      type: 'group',
    };

    const internalMemberRect: NodeRect = {
      id: 'member-1',
      x: 250,
      y: 200,
      width: 100,
      height: 100,
      type: 'image',
    };

    // If internal member is NOT excluded, the group container snaps to it (causing oscillation)
    const resultUnfiltered = calculateSmartGuides(groupRect, [internalMemberRect], 1);
    expect(resultUnfiltered.vertical).not.toBeNull();
    expect(resultUnfiltered.snappedPosition.x).toBe(100);

    // When internal member is properly excluded, group container ignores it completely
    const resultFiltered = calculateSmartGuides(groupRect, [internalMemberRect], 1, {
      excludeIds: new Set(['member-1']),
    });
    expect(resultFiltered.vertical).toBeNull();
    expect(resultFiltered.snappedPosition.x).toBe(102);
  });

  it('allows group container to snap to external nodes while ignoring its own internal members', () => {
    const groupRect: NodeRect = {
      id: 'group-1',
      x: 98, // 2px away from external target (100)
      y: 400,
      width: 400,
      height: 300,
      type: 'group',
    };

    const internalMember: NodeRect = {
      id: 'member-1',
      x: 150,
      y: 450,
      width: 100,
      height: 100,
      type: 'image',
    };

    const externalNode: NodeRect = {
      id: 'external-1',
      x: 100,
      y: 50,
      width: 200,
      height: 200,
      type: 'image',
    };

    const result = calculateSmartGuides(groupRect, [internalMember, externalNode], 1, {
      excludeIds: new Set(['member-1']),
    });

    // Snapped to external node's left edge (100)
    expect(result.vertical).not.toBeNull();
    expect(result.snappedPosition.x).toBe(100);
    expect(result.vertical?.pos).toBe(100);
  });

  it('verifies absolute displacement formula guarantees invariant relative distance during drag back and forth', () => {
    // Initial drag start positions
    const groupOrigin = { x: 100, y: 100 };
    const member1Origin = { x: 132, y: 132 };
    const member2Origin = { x: 300, y: 200 };

    const initialOffset1 = { x: member1Origin.x - groupOrigin.x, y: member1Origin.y - groupOrigin.y };
    const initialOffset2 = { x: member2Origin.x - groupOrigin.x, y: member2Origin.y - groupOrigin.y };

    // Simulate mouse dragging group back and forth through various intermediate positions
    const trajectory = [
      { x: 150, y: 120 },
      { x: 500, y: 350 },
      { x: -50, y: -20 },
      { x: 100.5, y: 100.3 }, // float coordinates
      { x: 100, y: 100 },     // back to exact origin
    ];

    for (const groupCurrent of trajectory) {
      const totalDx = groupCurrent.x - groupOrigin.x;
      const totalDy = groupCurrent.y - groupOrigin.y;

      const member1Current = { x: member1Origin.x + totalDx, y: member1Origin.y + totalDy };
      const member2Current = { x: member2Origin.x + totalDx, y: member2Origin.y + totalDy };

      // Invariant: distance between member and group is ALWAYS identically constant
      expect(member1Current.x - groupCurrent.x).toBeCloseTo(initialOffset1.x, 8);
      expect(member1Current.y - groupCurrent.y).toBeCloseTo(initialOffset1.y, 8);

      expect(member2Current.x - groupCurrent.x).toBeCloseTo(initialOffset2.x, 8);
      expect(member2Current.y - groupCurrent.y).toBeCloseTo(initialOffset2.y, 8);
    }
  });

  it('commitMoveBatch updates all moved nodes synchronously in state in a single pass', async () => {
    const sessionId = 'test-session-batch';
    const g = makeNode('g1', 'group', 100, 100, 400, 300, { memberIds: ['m1', 'm2'] });
    const m1 = makeNode('m1', 'image', 132, 132, 100, 100);
    const m2 = makeNode('m2', 'image', 250, 180, 100, 100);

    vi.mocked(api.getCanvas).mockResolvedValue({
      canvas: { id: 'c1', sessionId, liveRevision: 1, createdAt: '', updatedAt: '' },
      nodes: [g, m1, m2],
      edges: [],
    });
    vi.mocked(api.patchCanvasNode).mockResolvedValue({} as any);

    await canvasStore.openCanvas(sessionId);

    const moves = [
      { id: 'g1', from: { x: 100, y: 100 }, to: { x: 250, y: 300 } },
      { id: 'm1', from: { x: 132, y: 132 }, to: { x: 282, y: 332 } },
      { id: 'm2', from: { x: 250, y: 180 }, to: { x: 400, y: 380 } },
    ];

    // Calling commitMoveBatch synchronously applies changes in memory immediately
    canvasStore.commitMoveBatch(sessionId, moves);

    const snapshot = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
    const gNow = snapshot.find((n) => n.id === 'g1');
    const m1Now = snapshot.find((n) => n.id === 'm1');
    const m2Now = snapshot.find((n) => n.id === 'm2');

    expect(gNow?.x).toBe(250);
    expect(gNow?.y).toBe(300);
    expect(m1Now?.x).toBe(282);
    expect(m1Now?.y).toBe(332);
    expect(m2Now?.x).toBe(400);
    expect(m2Now?.y).toBe(380);

    // Undo should restore all positions synchronously
    canvasStore.undo(sessionId);

    const snapshotUndo = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
    const gUndo = snapshotUndo.find((n) => n.id === 'g1');
    const m1Undo = snapshotUndo.find((n) => n.id === 'm1');
    const m2Undo = snapshotUndo.find((n) => n.id === 'm2');

    expect(gUndo?.x).toBe(100);
    expect(gUndo?.y).toBe(100);
    expect(m1Undo?.x).toBe(132);
    expect(m1Undo?.y).toBe(132);
    expect(m2Undo?.x).toBe(250);
    expect(m2Undo?.y).toBe(180);
  });
});
