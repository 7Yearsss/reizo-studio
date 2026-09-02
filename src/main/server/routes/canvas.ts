import { Hono } from 'hono';
import type { SessionStore } from '../../../shared/chat';
import { defaultNodeBox, type CanvasNodeType } from '../../../shared/canvas';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from '../canvas/channel';
import { broadcastDownstreamDirty, readCanvasAsset, runImageNode } from '../canvas/imageExecutor';
import { runGraph } from '../canvas/graphExecutor';

const NODE_TYPES = new Set<CanvasNodeType>(['image', 'agent']);

export function createCanvasRouter(
  canvasStore: CanvasStore,
  settingsStore: SettingsStore,
  sessionStore: SessionStore,
  dataRoot: string,
) {
  const router = new Hono();

  /** Snapshot (creates the canvas row lazily on first read). */
  router.get('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = await sessionStore.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json(canvasStore.getSnapshotBySession(sessionId));
  });

  /** Long-lived NDJSON channel: replays ring events with rev > after, then tails. */
  router.get('/:canvasId/stream', (c) => {
    const after = Number(c.req.query('after') ?? '-1');
    return getCanvasChannel(c.req.param('canvasId')).stream(Number.isFinite(after) ? after : -1);
  });

  router.get('/assets/:canvasId/:file', async (c) => {
    const rel = `${c.req.param('canvasId')}/${c.req.param('file')}`;
    try {
      const bytes = await readCanvasAsset(dataRoot, rel);
      const ext = rel.split('.').pop()?.toLowerCase();
      const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': type, 'cache-control': 'private, max-age=31536000' },
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  router.post('/:canvasId/nodes', async (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    const body = await c.req.json().catch((): null => null);
    const type = body?.type as CanvasNodeType;
    if (!NODE_TYPES.has(type)) return c.json({ error: 'type must be "image" or "agent"' }, 400);
    const box = defaultNodeBox(type);
    const { rev, node } = canvasStore.addNode(canvasId, {
      type,
      x: typeof body.x === 'number' ? body.x : 0,
      y: typeof body.y === 'number' ? body.y : 0,
      w: typeof body.w === 'number' ? body.w : box.w,
      h: typeof body.h === 'number' ? body.h : box.h,
      title: typeof body.title === 'string' ? body.title : '',
      params: body.params && typeof body.params === 'object' ? body.params : {},
    });
    getCanvasChannel(canvasId).broadcast(rev, { type: 'node_added', node });
    return c.json({ node }, 201);
  });

  router.patch('/:canvasId/nodes/:id', async (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const body = await c.req.json().catch((): null => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'body required' }, 400);
    const patch: Record<string, unknown> = {};
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      if (typeof body[key] === 'number') patch[key] = body[key];
    }
    if (typeof body.title === 'string') patch.title = body.title;
    const paramsChanged = body.params && typeof body.params === 'object';
    if (paramsChanged) patch.params = body.params;
    const result = canvasStore.updateNode(canvasId, id, patch);
    if (!result) return c.json({ error: 'Node not found' }, 404);
    const channel = getCanvasChannel(canvasId);
    channel.broadcast(result.rev, { type: 'node_updated', node: result.node });
    // A param change can restate this node and everything downstream.
    if (paramsChanged) broadcastDownstreamDirty(canvasStore, canvasId, id, result.rev);
    return c.json({ node: result.node });
  });

  router.delete('/:canvasId/nodes/:id', (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const result = canvasStore.deleteNode(canvasId, id);
    if (!result) return c.json({ error: 'Node not found' }, 404);
    getCanvasChannel(canvasId).broadcast(result.rev, { type: 'node_deleted', id });
    return c.body(null, 204);
  });

  router.post('/:canvasId/edges', async (c) => {
    const canvasId = c.req.param('canvasId');
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.sourceId !== 'string' || typeof body?.targetId !== 'string') {
      return c.json({ error: 'sourceId and targetId are required' }, 400);
    }
    const result = canvasStore.addEdge(canvasId, {
      sourceId: body.sourceId,
      sourceHandle: typeof body.sourceHandle === 'string' ? body.sourceHandle : null,
      targetId: body.targetId,
      targetHandle: typeof body.targetHandle === 'string' ? body.targetHandle : null,
    });
    if (result.error === 'cycle') {
      return c.json({ error: 'That connection would create a cycle' }, 409);
    }
    if (result.error || !result.edge || result.rev === undefined) {
      return c.json({ error: 'source or target node not found' }, 404);
    }
    const channel = getCanvasChannel(canvasId);
    channel.broadcast(result.rev, { type: 'edge_added', edge: result.edge });
    broadcastDownstreamDirty(canvasStore, canvasId, result.edge.sourceId, result.rev);
    return c.json({ edge: result.edge }, 201);
  });

  router.delete('/:canvasId/edges/:id', (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const result = canvasStore.deleteEdge(canvasId, id);
    if (!result) return c.json({ error: 'Edge not found' }, 404);
    const channel = getCanvasChannel(canvasId);
    channel.broadcast(result.rev, { type: 'edge_deleted', id });
    broadcastDownstreamDirty(canvasStore, canvasId, result.targetId, result.rev);
    return c.body(null, 204);
  });

  /**
   * Run one node. Image generation is a paid call, so the renderer must send
   * `confirmedSpend: true` (a pre-flight dialog, not the chat permission
   * system — see docs/canvas-plan.md R3). Fire-and-forget: the executor
   * broadcasts run-state / output on the channel.
   */
  router.post('/:canvasId/nodes/:id/run', async (c) => {
    const canvasId = c.req.param('canvasId');
    const id = c.req.param('id');
    const node = canvasStore.getNode(canvasId, id);
    if (!node) return c.json({ error: 'Node not found' }, 404);
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));

    if (node.type === 'image') {
      if (body?.confirmedSpend !== true) {
        return c.json({ error: 'confirmedSpend required for a paid generation' }, 402);
      }
      void runImageNode({
        canvasStore,
        settingsStore,
        dataRoot,
        canvasId,
        node,
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      });
      return c.json({ ok: true }, 202);
    }

    // 'agent' node execution lands in P2.
    return c.json({ error: 'Agent node execution is not available yet' }, 501);
  });

  /**
   * Run the graph in topological order. `?from=<nodeId>` restricts it to that
   * node and its descendants. Paid (image nodes) -> `confirmedSpend` required.
   */
  router.post('/:canvasId/run', async (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));
    if (body?.confirmedSpend !== true) {
      return c.json({ error: 'confirmedSpend required for a paid run' }, 402);
    }
    const fromNodeId = typeof body.from === 'string' ? body.from : undefined;
    if (fromNodeId && !canvasStore.getNode(canvasId, fromNodeId)) {
      return c.json({ error: 'from node not found' }, 404);
    }
    void runGraph({
      canvasStore,
      settingsStore,
      dataRoot,
      canvasId,
      fromNodeId,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
    });
    return c.json({ ok: true }, 202);
  });

  return router;
}
