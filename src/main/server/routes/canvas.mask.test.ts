import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createCanvasRouter } from './canvas';

const settingsStore = {
  get: async () => ({ activeProviderId: 'openai', providers: {} }),
} as unknown as SettingsStore;

describe('POST /:canvasId/nodes/:id/mask', () => {
  it('writes a mask PNG and returns maskAsset', async () => {
    const handle = openDb(':memory:');
    const sessions = createSqliteSessionStore(handle);
    const canvasStore = createCanvasStore(handle);
    const session = await sessions.create('s', null, null);
    const canvas = canvasStore.ensureCanvas(session.id);
    const node = canvasStore.addNode(canvas.id, {
      type: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: '', size: '1024x1024' },
    }).node;
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-mask-'));
    const app = new Hono().route('/api/canvas', createCanvasRouter(canvasStore, settingsStore, sessions, dataRoot));

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await app.request(`/api/canvas/${canvas.id}/nodes/${node.id}/mask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataBase64: png.toString('base64') }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { maskAsset: string };
    expect(body.maskAsset).toMatch(new RegExp(`^${canvas.id}/${node.id}-mask-.*\\.png$`));
  });

  it('returns 400 when dataBase64 is missing', async () => {
    const handle = openDb(':memory:');
    const sessions = createSqliteSessionStore(handle);
    const canvasStore = createCanvasStore(handle);
    const session = await sessions.create('s', null, null);
    const canvas = canvasStore.ensureCanvas(session.id);
    const node = canvasStore.addNode(canvas.id, {
      type: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: {},
    }).node;
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-mask-'));
    const app = new Hono().route('/api/canvas', createCanvasRouter(canvasStore, settingsStore, sessions, dataRoot));
    const res = await app.request(`/api/canvas/${canvas.id}/nodes/${node.id}/mask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
