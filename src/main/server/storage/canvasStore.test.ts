import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from './sqliteSessionStore';
import { createCanvasStore } from './canvasStore';

async function freshStores() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvas = createCanvasStore(handle);
  const session = await sessions.create('s', null, null);
  return { canvas, sessionId: session.id, sessions };
}

describe('CanvasStore', () => {
  it('creates a canvas lazily and is idempotent per session', async () => {
    const { canvas, sessionId } = await freshStores();
    expect(canvas.findCanvasBySession(sessionId)).toBeNull();
    const a = canvas.ensureCanvas(sessionId);
    const b = canvas.ensureCanvas(sessionId);
    expect(a.id).toBe(b.id);
    expect(canvas.findCanvasBySession(sessionId)?.id).toBe(a.id);
  });

  it('bumps live_revision on every mutation', async () => {
    const { canvas, sessionId } = await freshStores();
    const c = canvas.ensureCanvas(sessionId);
    expect(c.liveRevision).toBe(0);

    const added = canvas.addNode(c.id, { type: 'image', x: 10, y: 20, w: 300, h: 380, params: { prompt: 'hi' } });
    expect(added.rev).toBe(1);
    expect(added.node.x).toBe(10);

    const moved = canvas.updateNode(c.id, added.node.id, { x: 99 });
    expect(moved?.rev).toBe(2);
    expect(moved?.node.x).toBe(99);

    const removed = canvas.deleteNode(c.id, added.node.id);
    expect(removed?.rev).toBe(3);
    expect(canvas.getSnapshot(c.id)?.nodes).toHaveLength(0);
  });

  it('adds and removes edges, and drops edges when a node is deleted', async () => {
    const { canvas, sessionId } = await freshStores();
    const c = canvas.ensureCanvas(sessionId);
    const src = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 1, h: 1, params: {} }).node;
    const tgt = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 1, h: 1, params: {} }).node;

    const edge = canvas.addEdge(c.id, { sourceId: src.id, targetId: tgt.id });
    expect(edge.edge?.sourceId).toBe(src.id);
    expect(canvas.getSnapshot(c.id)?.edges).toHaveLength(1);
    expect(canvas.upstreamNodes(c.id, tgt.id).map((n) => n.id)).toEqual([src.id]);

    canvas.deleteNode(c.id, src.id);
    expect(canvas.getSnapshot(c.id)?.edges).toHaveLength(0);
  });

  it('rejects an edge to a missing node, a duplicate, and a cycle', async () => {
    const { canvas, sessionId } = await freshStores();
    const c = canvas.ensureCanvas(sessionId);
    const a = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 1, h: 1, params: {} }).node;
    const b = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 1, h: 1, params: {} }).node;
    expect(canvas.addEdge(c.id, { sourceId: a.id, targetId: 'nope' }).error).toBe('missing');
    expect(canvas.addEdge(c.id, { sourceId: a.id, targetId: b.id }).edge).toBeTruthy();
    expect(canvas.addEdge(c.id, { sourceId: a.id, targetId: b.id }).error).toBe('cycle'); // duplicate
    expect(canvas.addEdge(c.id, { sourceId: b.id, targetId: a.id }).error).toBe('cycle');
  });

  it('rejects semantically incompatible edges (port guard)', async () => {
    const { canvas, sessionId } = await freshStores();
    const c = canvas.ensureCanvas(sessionId);
    const grp = canvas.addNode(c.id, { type: 'group', x: 0, y: 0, w: 100, h: 100, params: {} }).node;
    const img = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: {} }).node;
    const vid = canvas.addNode(c.id, { type: 'video', x: 0, y: 0, w: 100, h: 100, params: {} }).node;

    // Group containers cannot be wired directly
    expect(canvas.addEdge(c.id, { sourceId: grp.id, targetId: img.id }).error).toBe('incompatible');
    expect(canvas.addEdge(c.id, { sourceId: img.id, targetId: grp.id }).error).toBe('incompatible');

    // Video to Video without frame slot is incompatible
    expect(canvas.addEdge(c.id, { sourceId: vid.id, targetId: vid.id }).error).toBe('cycle');

    // Image to Video start_frame is compatible
    const validEdge = canvas.addEdge(c.id, { sourceId: img.id, targetId: vid.id, targetHandle: 'start_frame' });
    expect(validEdge.edge).toBeTruthy();
    expect(validEdge.error).toBeUndefined();
  });

  it('flags a node dirty when its params drift after a run', async () => {
    const { canvas, sessionId } = await freshStores();
    const c = canvas.ensureCanvas(sessionId);
    const n = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 1, h: 1, params: { prompt: 'a', size: '1024x1024' } }).node;

    // never run -> not dirty, just un-run
    expect(canvas.getSnapshot(c.id)?.nodes[0].dirty).toBe(false);

    // simulate a successful run: store the hash of the current inputs
    const { inputHash } = await import('../canvas/graph');
    const ran = canvas.getNode(c.id, n.id)!;
    canvas.updateNode(c.id, n.id, { runState: 'done', output: { assets: ['x'] }, paramsHash: inputHash(ran, []) });
    expect(canvas.getSnapshot(c.id)?.nodes[0].dirty).toBe(false);

    // change the prompt -> now stale
    canvas.updateNode(c.id, n.id, { params: { prompt: 'b', size: '1024x1024' } });
    expect(canvas.getSnapshot(c.id)?.nodes[0].dirty).toBe(true);
  });

  it('cascade-deletes the canvas when the session goes', async () => {
    const { canvas, sessionId, sessions } = await freshStores();
    const c = canvas.ensureCanvas(sessionId);
    canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 1, h: 1, params: {} });
    await sessions.remove(sessionId);
    expect(canvas.getCanvas(c.id)).toBeNull();
    expect(canvas.getSnapshot(c.id)).toBeNull();
  });
});
