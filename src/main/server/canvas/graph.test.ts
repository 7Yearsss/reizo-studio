import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../../shared/canvas';
import { buildPipelineWaves, descendants, directUpstream, inputHash, layoutGraph, topoOrder, wouldCycle } from './graph';

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

  it('layoutGraph puts downstream nodes in later columns', () => {
    const nodes = [node('a'), node('b'), node('c'), node('loose')];
    const pos = layoutGraph(nodes, [edge('a', 'b'), edge('b', 'c')], { x: 300, y: 200 });
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.b.x).toBeLessThan(pos.c.x);
    // a root and a loose node share the first column but different rows
    expect(pos.a.x).toBe(pos.loose.x);
    expect(pos.a.y).not.toBe(pos.loose.y);
  });

  it('inputHash changes with params and with an upstream output', () => {
    const target = node('t');
    const up = node('u');
    const base = inputHash(target, [up]);
    expect(inputHash(target, [up])).toBe(base);
    expect(inputHash({ ...target, params: { prompt: 'x', size: '1024x1024' } }, [up])).not.toBe(base);
    expect(inputHash(target, [{ ...up, output: { assets: ['c/x.png'] } }])).not.toBe(base);
  });

  describe('buildPipelineWaves', () => {
    const isRunnable = (type: string) => type === 'image' || type === 'video' || type === 'agent';

    it('groups independent root nodes into the same wave', () => {
      const nodes = [node('a'), node('b'), node('c'), node('d')];
      const waves = buildPipelineWaves(nodes, [], isRunnable);
      expect(waves).toHaveLength(1);
      expect(waves[0].sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('builds topological waves for a diamond DAG', () => {
      const nodes = [node('a'), node('b'), node('c'), node('d')];
      const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
      const waves = buildPipelineWaves(nodes, edges, isRunnable);
      expect(waves).toHaveLength(3);
      expect(waves[0]).toEqual(['a']);
      expect(waves[1].sort()).toEqual(['b', 'c']);
      expect(waves[2]).toEqual(['d']);
    });

    it('respects dependencies passing through non-runnable nodes', () => {
      const img1 = node('img1');
      const noteNode: CanvasNode = { ...node('note1'), type: 'note' };
      const img2 = node('img2');
      const edges = [edge('img1', 'note1'), edge('note1', 'img2')];
      const waves = buildPipelineWaves([img1, noteNode, img2], edges, isRunnable);
      expect(waves).toHaveLength(2);
      expect(waves[0]).toEqual(['img1']);
      expect(waves[1]).toEqual(['img2']);
    });

    it('restricts wave construction to inScope nodes', () => {
      const nodes = [node('a'), node('b'), node('c')];
      const edges = [edge('a', 'b'), edge('b', 'c')];
      const waves = buildPipelineWaves(nodes, edges, isRunnable, new Set(['b', 'c']));
      expect(waves).toHaveLength(2);
      expect(waves[0]).toEqual(['b']);
      expect(waves[1]).toEqual(['c']);
    });
  });
});
