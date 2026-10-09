import { describe, expect, it } from 'vitest';
import type { CanvasNode, CanvasEdge } from '../../shared/canvas';
import { canvasInputSources, indexedCanvasNode } from './canvasInputSources';

function node(id: string, title = id): CanvasNode {
  return { id, title, type: 'note', canvasId: 'c', x: 0, y: 0, w: 320, h: 220, params: {}, paramsHash: null, runState: 'idle', output: null, updatedAt: '' };
}

describe('canvas input projection', () => {
  it('keeps geometry-only edits local, updates labels/topology and preserves previous projections', () => {
    const nodes = [node('a', 'Writer'), { ...node('b', ''), type: 'image' as const }, node('c')];
    const edges: CanvasEdge[] = [{ id: 'e1', canvasId: 'c', sourceId: 'a', targetId: 'c', sourceHandle: 'out', targetHandle: 'prompt' },
      { id: 'e2', canvasId: 'c', sourceId: 'b', targetId: 'c', sourceHandle: 'out', targetHandle: 'reference' }];
    const initial = canvasInputSources(nodes, edges, 'c');
    expect(initial.map((source) => source.sourceTitle)).toEqual(['Writer', '参考图']);
    const moved = nodes.map((value) => value.id === 'a' ? { ...value, x: 50 } : value);
    expect(canvasInputSources(moved, edges, 'c')).toBe(initial);
    expect(indexedCanvasNode(moved, 'a')?.x).toBe(50);
    const renamed = moved.map((value) => value.id === 'a' ? { ...value, title: 'Editor' } : value);
    expect(canvasInputSources(renamed, edges, 'c')[0].sourceTitle).toBe('Editor');
    expect(initial[0].sourceTitle).toBe('Writer');
    expect(canvasInputSources(renamed, edges, 'c', '图片')[1].sourceTitle).toBe('图片');
    expect(canvasInputSources(renamed, edges.slice(1), 'c')).toHaveLength(1);
    expect(canvasInputSources([node('a', 'Other session'), node('c')], [{ ...edges[0], canvasId: 'other' }], 'c')[0].sourceTitle).toBe('Other session');
    const missing = canvasInputSources(renamed.filter((value) => value.id !== 'a'), edges, 'c');
    expect(missing[0]).toMatchObject({ sourceType: 'node', sourceTitle: '节点' });
  });
});
