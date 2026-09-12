import { describe, it, expect } from 'vitest';
import { computeNodeZIndexes, computeEdgeZIndex } from './CanvasPanel';
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

describe('computeEdgeZIndex (Edge Visibility & Group Occlusion)', () => {
  it('ensures internal group edges are rendered above the group container and below member cards', () => {
    const member1 = makeNode('in1', 'image');
    const member2 = makeNode('in2', 'image');
    const group = makeNode('g1', 'group', { memberIds: ['in1', 'in2'] });

    const zMap = computeNodeZIndexes([member1, member2, group]);
    const groupZ = zMap.get('g1')!;
    const member1Z = zMap.get('in1')!;
    const member2Z = zMap.get('in2')!;

    const edgeZ = computeEdgeZIndex({ sourceId: 'in1', targetId: 'in2' }, zMap);

    // Strictly above the group container background
    expect(edgeZ).toBeGreaterThan(groupZ);
    // Strictly below member node card surface
    expect(edgeZ).toBeLessThan(member1Z);
    expect(edgeZ).toBeLessThan(member2Z);
    expect(edgeZ).toBe(19);
  });

  it('ensures inbound edges from outside nodes into group members are rendered above the group container', () => {
    const outside = makeNode('prompt_out', 'note');
    const member = makeNode('img_in', 'image');
    const group = makeNode('g1', 'group', { memberIds: ['img_in'] });

    const zMap = computeNodeZIndexes([outside, member, group]);
    const groupZ = zMap.get('g1')!;
    const memberZ = zMap.get('img_in')!;
    const outsideZ = zMap.get('prompt_out')!;

    const edgeZ = computeEdgeZIndex({ sourceId: 'prompt_out', targetId: 'img_in' }, zMap);

    // Must be above the group container so it does not get clipped/cut off at the group border
    expect(edgeZ).toBeGreaterThan(groupZ);
    // Must be below member node card
    expect(edgeZ).toBeLessThan(memberZ);
    // Must be above outside node base level
    expect(edgeZ).toBeGreaterThan(outsideZ);
  });

  it('ensures outbound edges from group members to outside nodes are rendered above the group container', () => {
    const member = makeNode('img_in', 'image');
    const outside = makeNode('video_out', 'video');
    const group = makeNode('g1', 'group', { memberIds: ['img_in'] });

    const zMap = computeNodeZIndexes([member, outside, group]);
    const groupZ = zMap.get('g1')!;

    const edgeZ = computeEdgeZIndex({ sourceId: 'img_in', targetId: 'video_out' }, zMap);

    expect(edgeZ).toBeGreaterThan(groupZ);
  });

  it('elevates edge z-index when group is selected', () => {
    const member1 = makeNode('in1', 'image');
    const member2 = makeNode('in2', 'image');
    const group = makeNode('g1', 'group', { memberIds: ['in1', 'in2'] });

    // Group selected
    const zMap = computeNodeZIndexes([member1, member2, group], (id) => id === 'g1');
    const groupZ = zMap.get('g1')!; // 15
    const memberZ = zMap.get('in1')!; // 25

    const edgeZ = computeEdgeZIndex({ sourceId: 'in1', targetId: 'in2' }, zMap);

    expect(groupZ).toBe(15);
    expect(memberZ).toBe(25);
    expect(edgeZ).toBe(24);
    expect(edgeZ).toBeGreaterThan(groupZ);
    expect(edgeZ).toBeLessThan(memberZ);
  });

  it('keeps edges between unselected outside nodes at base level (occluded if placed under group)', () => {
    const out1 = makeNode('out1', 'image');
    const out2 = makeNode('out2', 'image');
    const group = makeNode('g1', 'group', { memberIds: [] });

    const zMap = computeNodeZIndexes([out1, out2, group]);
    const groupZ = zMap.get('g1')!;

    const edgeZ = computeEdgeZIndex({ sourceId: 'out1', targetId: 'out2' }, zMap);

    expect(edgeZ).toBe(0);
    expect(edgeZ).toBeLessThan(groupZ);
  });
});

