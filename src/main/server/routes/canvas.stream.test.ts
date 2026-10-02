import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { openDb, type DbHandle } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { getCanvasChannel } from '../canvas/channel';
import { createCanvasRouter } from './canvas';

const handles: DbHandle[] = [];
afterEach(() => { for (const handle of handles.splice(0)) handle.close(); });

function streamReader(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (!response.body) throw new Error('Expected a stream response body');
  return response.body.getReader();
}

async function fixture() {
  const handle = openDb(':memory:');
  handles.push(handle);
  const sessions = createSqliteSessionStore(handle);
  const store = createCanvasStore(handle);
  const session = await sessions.create('stream-route', null, null);
  const canvas = store.ensureCanvas(session.id);
  const settings = { get: async () => ({ activeProviderId: 'openai', providers: {} }) } as unknown as SettingsStore;
  const app = new Hono().route('/api/canvas', createCanvasRouter(store, settings, sessions, '.'));
  return { app, canvas, store };
}

describe('GET /:canvasId/stream', () => {
  it.each(['', '?protocol=2'])('returns 404 for an unknown canvas with %s', async (query) => {
    const { app } = await fixture();
    const response = await app.request(`/api/canvas/missing/stream${query}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Canvas not found' });
  });

  it('selects durable v2 commit replay through the protocol query', async () => {
    const { app, store, canvas } = await fixture();
    store.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 100, h: 100 });
    const response = await app.request(`/api/canvas/${canvas.id}/stream?protocol=2&after=0`);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const reader = streamReader(response);
    const message = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    expect(message).toMatchObject({ v: 2, kind: 'commit', commit: { revision: 1 } });
    await reader.cancel();
  });

  it('preserves v1 for clients that omit protocol', async () => {
    const { app, store, canvas } = await fixture();
    const added = store.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 100, h: 100 });
    getCanvasChannel(canvas.id).broadcast(added.rev, { type: 'node_added', node: added.node });
    const response = await app.request(`/api/canvas/${canvas.id}/stream?after=0`);
    const reader = streamReader(response);
    const message = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    expect(message).toMatchObject({ v: 1, event: { type: 'node_added' } });
    await reader.cancel();
  });
});
