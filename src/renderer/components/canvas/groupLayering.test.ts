import { describe, it, expect } from 'vitest';
import { computeNodeZIndexes } from './CanvasPanel';
import type { CanvasNode } from '../../../shared/canvas';

function makeNode(id: string, type: CanvasNode['type'], params: Record<string, unknown> = {}): CanvasNode {
  return {
    id,
    canvasId: 'c1',
    type,
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    title: id,
    params,
    paramsHash: null,
    runState: 'idle',
    output: null,
    updatedAt: new Date().toISOString(),
  };
}

describe('computeNodeZIndexes (Canvas Occlusion & Layering)', () => {
  it('assigns correct relative z-indices: member > group > outside node > section', () => {
    const section = makeNode('s1', 'section');
    const outsideNode = makeNode('img_outside', 'image');
    const memberNode1 = makeNode('img_in1', 'image');
    const memberNode2 = makeNode('img_in2', 'image');
    const groupNode = makeNode('g1', 'group', {
      memberIds: ['img_in1', 'img_in2'],
    });

    const nodes = [section, outsideNode, memberNode1, memberNode2, groupNode];
    const zMap = computeNodeZIndexes(nodes);

    const sectionZ = zMap.get('s1')!;
    const outsideZ = zMap.get('img_outside')!;
    const groupZ = zMap.get('g1')!;
    const member1Z = zMap.get('img_in1')!;
    const member2Z = zMap.get('img_in2')!;

    // 1. Section is in the background
    expect(sectionZ).toBe(-1);

    // 2. Group covers outside standalone nodes (groupZ > outsideZ)
    expect(groupZ).toBeGreaterThan(outsideZ);

    // 3. Member nodes are strictly above group container (memberZ > groupZ)
    expect(member1Z).toBeGreaterThan(groupZ);
    expect(member2Z).toBeGreaterThan(groupZ);
  });

  it('elevates group and members when group is selected, keeping members on top and covering outside nodes', () => {
    const outsideNode = makeNode('img_outside', 'image');
    const memberNode = makeNode('img_in', 'image');
    const groupNode = makeNode('g1', 'group', {
      memberIds: ['img_in'],
    });

    const nodes = [outsideNode, memberNode, groupNode];
    // Simulate group being selected
    const zMap = computeNodeZIndexes(nodes, (id) => id === 'g1');

    const outsideZ = zMap.get('img_outside')!;
    const groupZ = zMap.get('g1')!;
    const memberZ = zMap.get('img_in')!;

    expect(groupZ).toBe(15);
    expect(memberZ).toBe(25);
    expect(outsideZ).toBe(1);

    // Both group and member are way above outside node
    expect(groupZ).toBeGreaterThan(outsideZ);
    expect(memberZ).toBeGreaterThan(groupZ);
  });
});
