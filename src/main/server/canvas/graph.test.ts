import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../../shared/canvas';
import { descendants, directUpstream, inputHash, topoOrder, wouldCycle } from './graph';

function node(id: string): CanvasNode {
  return {
    id,
    canvasId: 'c',
    type: 'image',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    title: '',
    params: { prompt: id, size: '1024x1024' },
    paramsHash: null,
    runState: 'idle',
    output: null,
    updatedAt: '',
  };
}

function edge(source: string, target: string): CanvasEdge {
  return { id: `${source}-${target}`, canvasId: 'c', sourceId: source, sourceHandle: null, targetId: target, targetHandle: null };
}

describe('canvas graph helpers', () => {
  it('topoOrder respects dependencies and flags cycles', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const acyclic = topoOrder(nodes, [edge('a', 'b'), edge('b', 'c')]);
    expect(acyclic.cycle).toBe(false);
    expect(acyclic.order.indexOf('a')).toBeLessThan(acyclic.order.indexOf('b'));
    expect(acyclic.order.indexOf('b')).toBeLessThan(acyclic.order.indexOf('c'));

    const cyclic = topoOrder(nodes, [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(cyclic.cycle).toBe(true);
  });

  it('wouldCycle detects a back edge', () => {
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(wouldCycle(edges, 'c', 'a')).toBe(true);
    expect(wouldCycle(edges, 'a', 'c')).toBe(false);
    expect(wouldCycle(edges, 'a', 'a')).toBe(true);
  });

  it('descendants and directUpstream walk the graph', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'd')];
    expect([...descendants(edges, 'a')].sort()).toEqual(['b', 'c', 'd']);
    expect([...descendants(edges, 'b')]).toEqual(['c']);
    expect(directUpstream(edges, 'c')).toEqual(['b']);
  });

  it('inputHash changes with params and with an upstream output', () => {
    const target = node('t');
    const up = node('u');
    const base = inputHash(target, [up]);
    expect(inputHash(target, [up])).toBe(base);
    expect(inputHash({ ...target, params: { prompt: 'x', size: '1024x1024' } }, [up])).not.toBe(base);
    expect(inputHash(target, [{ ...up, output: { assets: ['c/x.png'] } }])).not.toBe(base);
  });
});
