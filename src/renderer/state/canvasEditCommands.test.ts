import { expect, it, vi } from 'vitest';
import type { CanvasSnapshot } from '../../shared/canvas';
import type { CanvasEdit } from '../../shared/canvasEdits';
import { CanvasEditCommands } from './canvasEditCommands';

it('shares creation clicks and replays a lost response with the original receipt and inverse only once', async () => {
  let snapshot: CanvasSnapshot = { canvas: { id: 'canvas', sessionId: 'session', liveRevision: 3, createdAt: '', updatedAt: '' }, nodes: [], edges: [] };
  let committed = snapshot;
  const receipts = new Set<string>();
  const calls: { id: string; revision: number; edits: CanvasEdit[] }[] = [];
  const record = vi.fn();
  const commands = new CanvasEditCommands(() => ({ snapshot, accept: (next) => { snapshot = next; } }),
    async (_canvasId, edits, id, revision) => {
      calls.push({ id, revision, edits });
      if (!receipts.has(id)) {
        receipts.add(id);
        const edit = edits[0];
        if (edit.kind !== 'add_node') throw new Error('expected a creation plan');
        committed = { ...snapshot, canvas: { ...snapshot.canvas, liveRevision: 4 }, nodes: [{
          ...edit.node, id: edit.id, canvasId: 'canvas', w: 320, h: 380, title: edit.node.title ?? '',
          params: edit.node.params ?? {}, paramsHash: null, runState: 'idle', output: null, updatedAt: '',
        }] };
        throw new TypeError('response lost after commit');
      }
      return committed;
    }, record);
  const edits: CanvasEdit[] = [{ kind: 'add_node', id: 'fixed-node', node: { type: 'image', x: 0, y: 0, title: 'fixed plan' } }];
  const create = commands.prepare('session', edits);
  (edits[0] as Extract<CanvasEdit, { kind: 'add_node' }>).node.title = 'caller changed';
  const first = create();
  expect(create()).toBe(first);
  await expect(first).rejects.toThrow('response lost after commit');
  expect(record).not.toHaveBeenCalled();
  // The durable stream can advance projection before a transport retry arrives.
  snapshot = committed;
  const retry = create();
  expect(create()).toBe(retry);
  await retry;
  await create();
  expect(receipts.size).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[1].id).toBe(calls[0].id);
  expect(calls.map((call) => call.revision)).toEqual([3, 3]);
  expect(snapshot.nodes).toHaveLength(1);
  expect(snapshot.nodes[0].title).toBe('fixed plan');
  expect(record).toHaveBeenCalledTimes(1);
  expect(record).toHaveBeenCalledWith('session', expect.objectContaining({ undo: expect.any(Function), redo: expect.any(Function) }));
});
