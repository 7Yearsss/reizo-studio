import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../shared/canvas';
import type { CanvasSyncMessage } from '../../shared/canvasSync';
import { inspectCanvasSyncMessage, projectCanvasChanges, type CanvasDocument, type CanvasSyncCursor } from './canvasSync';

function node(id: string): CanvasNode {
  return { id, canvasId: 'c1', type: 'image', x: 0, y: 0, w: 320, h: 380, title: id, params: {}, paramsHash: null, runState: 'idle', output: null, updatedAt: '' };
}

function edge(id: string, sourceId: string, targetId: string): CanvasEdge {
  return { id, canvasId: 'c1', sourceId, targetId, sourceHandle: null, targetHandle: null };
}

describe('canvas commit projection', () => {
  it('projects all node and edge changes together and preserves untouched entities', () => {
    const a = node('a');
    const b = node('b');
    const untouched = node('untouched');
    const existing = edge('existing', 'b', 'untouched');
    const document = { nodes: [a, b, untouched], edges: [existing] };
    const created = node('created');
    const updated = { ...b, title: 'Changed' };
    const addedEdge = edge('new', 'created', 'b');
    const result = projectCanvasChanges(document, [
      { type: 'node_deleted', id: 'a' },
      { type: 'node_updated', node: updated },
      { type: 'node_added', node: created },
      { type: 'edge_added', edge: addedEdge },
    ]);
    expect(result.nodes).toEqual([updated, untouched, created]);
    expect(result.edges).toEqual([existing, addedEdge]);
    expect(result.nodes[1]).toBe(untouched);
    expect(result.edges[0]).toBe(existing);
    expect(document.nodes).toEqual([a, b, untouched]);
  });

  it('deletes incident edges in the same projection, even without separate edge events', () => {
    const surviving = edge('keep', 'b', 'c');
    const result = projectCanvasChanges({ nodes: [node('a'), node('b'), node('c')], edges: [edge('in', 'b', 'a'), edge('out', 'a', 'c'), surviving] }, [
      { type: 'node_deleted', id: 'a' },
    ]);
    expect(result.nodes.map((item) => item.id)).toEqual(['b', 'c']);
    expect(result.edges).toEqual([surviving]);
    expect(result.edges[0]).toBe(surviving);
  });

  it('leaves arrays stable for unaffected and already-applied changes', () => {
    const a = node('a');
    const document: CanvasDocument = { nodes: [a], edges: [] };
    expect(projectCanvasChanges(document, [{ type: 'node_added', node: a }, { type: 'edge_deleted', id: 'missing' }, { type: 'run_state', id: 'a', runState: 'idle' }])).toBe(document);
    const output = projectCanvasChanges(document, [{ type: 'node_output', id: 'a', runState: 'done', output: { assets: ['c1/a.png'] } }]);
    expect(output.edges).toBe(document.edges);
    expect(output.nodes[0].output?.assets).toEqual(['c1/a.png']);
  });
});

describe('canvas document cursor', () => {
  const cursor = { canvasId: 'c1', revision: 7, epoch: 'e1' };
  const commit = (revision: number, canvasId = 'c1', epoch = 'e1'): CanvasSyncMessage => ({ v: 2, canvasId, epoch, kind: 'commit', commit: { canvasId, revision, changes: [{ type: 'node_added', node: node('new') }] } });

  it('ignores duplicate, stale and foreign canvas commits', () => {
    expect(inspectCanvasSyncMessage(cursor, commit(7))).toEqual({ kind: 'ignore' });
    expect(inspectCanvasSyncMessage(cursor, commit(3))).toEqual({ kind: 'ignore' });
    expect(inspectCanvasSyncMessage(cursor, commit(8, 'foreign'))).toEqual({ kind: 'ignore' });
  });

  it('accepts exactly the next complete commit and requests snapshots for gaps or epoch changes', () => {
    expect(inspectCanvasSyncMessage(cursor, commit(8))).toMatchObject({ kind: 'commit', cursor: { revision: 8, epoch: 'e1' } });
    expect(inspectCanvasSyncMessage(cursor, commit(9))).toEqual({ kind: 'resync', epoch: 'e1' });
    expect(inspectCanvasSyncMessage(cursor, commit(8, 'c1', 'e2'))).toEqual({ kind: 'resync', epoch: 'e2' });
    expect(inspectCanvasSyncMessage(cursor, { v: 2, canvasId: 'c1', epoch: 'e1', kind: 'resync', revision: 7 })).toEqual({ kind: 'resync', epoch: 'e1' });
  });

  it('activity and heartbeat establish the epoch without consuming document revisions', () => {
    const initial: CanvasSyncCursor = { ...cursor, epoch: null };
    for (const event of [{ type: 'phase' as const, label: 'Planning' }, { type: 'graph_run' as const, running: true, done: 0, total: 2 }]) {
      expect(inspectCanvasSyncMessage(initial, { v: 2, canvasId: 'c1', epoch: 'e1', kind: 'activity', event })).toMatchObject({ kind: 'activity', cursor });
    }
    expect(inspectCanvasSyncMessage(initial, { v: 2, canvasId: 'c1', epoch: 'e1', kind: 'heartbeat', revision: 7 })).toEqual({ kind: 'heartbeat', cursor });
    expect(inspectCanvasSyncMessage(cursor, { v: 2, canvasId: 'c1', epoch: 'e1', kind: 'heartbeat', revision: 10 })).toEqual({ kind: 'resync', epoch: 'e1' });
    expect(inspectCanvasSyncMessage(cursor, { v: 2, canvasId: 'c1', epoch: 'e1', kind: 'heartbeat', revision: 3 })).toEqual({ kind: 'resync', epoch: 'e1' });
  });
});
