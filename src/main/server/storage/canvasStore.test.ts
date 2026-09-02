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
    expect(edge?.edge.sourceId).toBe(src.id);
    expect(canvas.getSnapshot(c.id)?.edges).toHaveLength(1);
    expect(canvas.upstreamNodes(c.id, tgt.id).map((n) => n.id)).toEqual([src.id]);

    canvas.deleteNode(c.id, src.id);
    expect(canvas.getSnapshot(c.id)?.edges).toHaveLength(0);
  });

  it('rejects an edge to a missing node', async () => {
    const { canvas, sessionId } = await freshStores();
    const c = canvas.ensureCanvas(sessionId);
    const src = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 1, h: 1, params: {} }).node;
    expect(canvas.addEdge(c.id, { sourceId: src.id, targetId: 'nope' })).toBeNull();
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
