import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { SessionStore } from '../../../shared/chat';
import { defaultNodeBox, type CanvasNodeType } from '../../../shared/canvas';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import type { ArtifactStore } from '../storage/artifactStore';
import { getCanvasChannel } from '../canvas/channel';
import { broadcastDownstreamDirty, canvasAssetsDir, readCanvasAsset, runImageNode } from '../canvas/imageExecutor';
import { isCanvasRunning, runGraph, stopCanvasRun } from '../canvas/graphExecutor';
import { runAgentNode } from '../canvas/agentExecutor';
import { setCanvasSelection } from '../canvas/selection';

const NODE_TYPES = new Set<CanvasNodeType>(['image', 'agent']);
const IMPORT_MAX_BYTES = 12 * 1024 * 1024;

export function createCanvasRouter(
  canvasStore: CanvasStore,
  settingsStore: SettingsStore,
  sessionStore: SessionStore,
  dataRoot: string,
  artifactStore?: ArtifactStore,
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

    // Agent node: a headless read-only sub-agent pass. Cheap (text only), so
    // no spend gate — it streams its answer onto the node.
    void runAgentNode({
      canvasStore,
      settingsStore,
      canvasId,
      node,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
    });
    return c.json({ ok: true }, 202);
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

  router.post('/:canvasId/run/stop', (c) => {
    const stopped = stopCanvasRun(c.req.param('canvasId'));
    return c.json({ stopped, running: isCanvasRunning(c.req.param('canvasId')) });
  });

  /** Import a dropped image file as a `done` image node. */
  router.post('/:canvasId/import', async (c) => {
    const canvasId = c.req.param('canvasId');
    if (!canvasStore.getCanvas(canvasId)) return c.json({ error: 'Canvas not found' }, 404);
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.dataBase64 !== 'string' || typeof body?.name !== 'string') {
      return c.json({ error: 'name and dataBase64 are required' }, 400);
    }
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > IMPORT_MAX_BYTES) {
      return c.json({ error: `Image must be 1 byte – ${IMPORT_MAX_BYTES} bytes` }, 413);
    }
    const ext = (body.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const box = defaultNodeBox('image');
    const { rev, node } = canvasStore.addNode(canvasId, {
      type: 'image',
      x: typeof body.x === 'number' ? body.x : 40,
      y: typeof body.y === 'number' ? body.y : 40,
      w: box.w,
      h: box.h,
      title: body.name.slice(0, 80),
      params: { prompt: '', size: '1024x1024' },
    });
    const dir = canvasAssetsDir(dataRoot, canvasId);
    await mkdir(dir, { recursive: true });
    const file = `${node.id}-import-${nanoid(6)}.${ext}`;
    await writeFile(path.join(dir, file), bytes);
    getCanvasChannel(canvasId).broadcast(rev, { type: 'node_added', node });
    const withAsset = canvasStore.updateNode(canvasId, node.id, {
      runState: 'done',
      output: { assets: [`${canvasId}/${file}`] },
    });
    if (withAsset) {
      getCanvasChannel(canvasId).broadcast(withAsset.rev, {
        type: 'node_output',
        id: node.id,
        output: withAsset.node.output ?? { assets: [`${canvasId}/${file}`] },
        runState: 'done',
      });
    }
    return c.json({ node: withAsset?.node ?? node }, 201);
  });

  /** Copy one of a node's output images into the session's Artifacts. */
  router.post('/:canvasId/nodes/:id/save-asset', async (c) => {
    if (!artifactStore) return c.json({ error: 'Artifacts unavailable' }, 501);
    const canvasId = c.req.param('canvasId');
    const node = canvasStore.getNode(canvasId, c.req.param('id'));
    if (!node) return c.json({ error: 'Node not found' }, 404);
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));
    const index = typeof body.assetIndex === 'number' ? body.assetIndex : 0;
    const rel = node.output?.assets?.[index];
    if (!rel) return c.json({ error: 'No such asset' }, 404);
    const canvas = canvasStore.getCanvas(canvasId);
    let bytes: Buffer;
    try {
      bytes = await readCanvasAsset(dataRoot, rel);
    } catch {
      return c.json({ error: 'Asset missing on disk' }, 404);
    }
    const session = canvas ? await sessionStore.get(canvas.sessionId) : null;
    const ext = rel.split('.').pop() || 'png';
    // Stable per-node name so re-saving a re-run of the same node appends a
    // version to one artifact instead of piling up rows (IM3 — regenerate
    // history via the version rail).
    const name = `${(node.title || 'canvas-image').replace(/[^\w.-]+/g, '-').slice(0, 48)}-${node.id.slice(0, 6)}.${ext}`;
    const p = node.params as { prompt?: string; model?: string };
    const artifact = await artifactStore.createOrAddVersion({
      sessionId: canvas?.sessionId ?? '',
      projectId: session?.projectId ?? null,
      name,
      kind: 'image',
      bytes,
      mimeType: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png',
      source: 'generated',
      origin: {
        surface: 'canvas',
        canvasNodeId: node.id,
        prompt: p.prompt?.slice(0, 400),
        model: p.model,
      },
    });
    return c.json({ artifact }, 201);
  });

  /** Record the user's current node selection (feeds the agent's canvas summary). */
  router.put('/:canvasId/selection', async (c) => {
    const body = await c.req.json().catch((): null => null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown): v is string => typeof v === 'string') : [];
    setCanvasSelection(c.req.param('canvasId'), ids);
    return c.json({ ok: true });
  });

  return router;
}
