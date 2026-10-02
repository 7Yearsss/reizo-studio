import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createCanvasRouter } from '../routes/canvas';
import { createCanvasTools } from '../agent/canvasTools';
import type { CanvasEvent } from '../../../shared/canvasStream';
import { createCanvasApplication } from './application';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
const image = { type: 'image' as const, x: 0, y: 0, w: 100, h: 100, params: { prompt: 'product' } };
const settings = { get: async () => ({ activeProviderId: 'openai', providers: {} }) } as unknown as SettingsStore;

async function setup(dbPath = ':memory:') {
  const handle = openDb(dbPath);
  cleanup.push(() => handle.close());
  const sessions = createSqliteSessionStore(handle);
  const store = createCanvasStore(handle);
  const session = await sessions.create('test', null, null);
  const canvas = store.ensureCanvas(session.id);
  const events: CanvasEvent[] = [];
  const cancelled: string[] = [];
  const app = createCanvasApplication(store, {
    publish: (_id, _rev, event) => events.push(event),
    cancelNode: (_id, nodeId) => cancelled.push(nodeId),
  });
  return { handle, sessions, store, session, canvas, events, cancelled, app };
}

describe('CanvasApplication command interface', () => {
  it('rolls back the entire compound command and publishes nothing on validation failure', async () => {
    const { app, canvas, store, events } = await setup();
    expect(() => app.batch(canvas.id, { kind: 'compound' }, () => {
      app.addNode(canvas.id, image);
      app.addNode(canvas.id, { ...image, w: -1 });
    })).toThrow(/w/);
    expect(store.getSnapshot(canvas.id)?.nodes).toEqual([]);
    expect(store.getCanvas(canvas.id)?.liveRevision).toBe(0);
    expect(events).toEqual([]);
  });

  it('replays a persisted receipt across application instances without a second write or broadcast', async () => {
    const { app, canvas, store, events } = await setup();
    const first = app.addNode(canvas.id, image, 'same-request');
    const second = createCanvasApplication(store).addNode(canvas.id, { ...image, params: { prompt: 'product' } }, 'same-request');
    expect(second).toEqual(first);
    expect(store.getNodes(canvas.id)).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(store.getCanvas(canvas.id)?.liveRevision).toBe(1);
    expect(() => app.addNode(canvas.id, { ...image, title: 'different' }, 'same-request')).toThrow(/different command/);
  });

  it('retains command receipts after the database is reopened', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'reizo-receipts-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const dbPath = path.join(root, 'test.db');
    const { app, canvas, handle } = await setup(dbPath);
    const first = app.addNode(canvas.id, image, 'restart-retry');
    cleanup.pop();
    handle.close();
    const reopened = openDb(dbPath);
    cleanup.push(() => reopened.close());
    const store = createCanvasStore(reopened);
    expect(createCanvasApplication(store).addNode(canvas.id, image, 'restart-retry')).toEqual(first);
    expect(store.getNodes(canvas.id)).toHaveLength(1);
  });

  it('cancels deleted nodes only after commit and removes their connected edges', async () => {
    const { app, canvas, store, events, cancelled } = await setup();
    const source = app.addNode(canvas.id, image).node;
    const target = app.addNode(canvas.id, image).node;
    app.addEdge(canvas.id, { sourceId: source.id, targetId: target.id });
    events.length = 0;
    expect(() => app.batch(canvas.id, { kind: 'failed_delete' }, () => {
      app.deleteNode(canvas.id, source.id);
      throw new Error('failed');
    })).toThrow('failed');
    expect(cancelled).toEqual([]);
    expect(events).toEqual([]);
    expect(store.getNode(canvas.id, source.id)).not.toBeNull();
    app.deleteNode(canvas.id, source.id);
    expect(cancelled).toEqual([source.id]);
    expect(store.getEdges(canvas.id)).toEqual([]);
    expect(events.some((event) => event.type === 'edge_deleted')).toBe(true);
  });

  it('HTTP uses the same validation and persists idempotency keys', async () => {
    const { store, sessions, canvas } = await setup();
    const http = new Hono().route('/api/canvas', createCanvasRouter(store, settings, sessions, '.'));
    const post = (body: unknown) => http.request(`/api/canvas/${canvas.id}/nodes`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'http-retry' }, body: JSON.stringify(body),
    });
    const first = await post(image);
    expect(first.status).toBe(201);
    expect(await (await post(image)).json()).toEqual(await first.json());
    expect(store.getNodes(canvas.id)).toHaveLength(1);
    expect((await post({ ...image, title: 'changed' })).status).toBe(409);
    const bad = await http.request(`/api/canvas/${canvas.id}/nodes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...image, w: -1 }),
    });
    expect(bad.status).toBe(400);
  });

  it('Agent add_node retries retain the same node and reference edges', async () => {
    const { store, session, canvas } = await setup();
    const product = store.addNode(canvas.id, image).node;
    const tools = () => createCanvasTools({ sessionId: session.id, canvasStore: store, settingsStore: settings, dataRoot: '.' }).tools;
    const input = { type: 'image' as const, prompt: `@[产品](canvas:${product.id})`, operationId: 'agent-retry' };
    const first = await tools().add_node.execute(input, { toolCallId: '1', messages: [], context: undefined });
    const second = await tools().add_node.execute(input, { toolCallId: '2', messages: [], context: undefined });
    expect(second).toEqual(first);
    expect(store.getNodes(canvas.id)).toHaveLength(2);
    expect(store.getEdges(canvas.id)).toHaveLength(1);
  });
});
