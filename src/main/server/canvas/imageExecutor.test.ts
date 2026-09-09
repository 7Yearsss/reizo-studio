import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { buildEditPrompt } from '../../../shared/canvasImageEdit';

const generateImageMock = vi.fn();

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateImage: (opts: unknown) => generateImageMock(opts),
  };
});

vi.mock('../agent/provider/openai', () => ({
  createOpenAiProvider: () => ({
    image: (id: string) => ({ id }),
  }),
}));

import { canvasAssetsDir, runImageNode } from './imageExecutor';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const settingsStore = {
  get: async () => ({
    activeProviderId: 'openai',
    providers: {
      openai: { apiKey: 'sk-test', baseUrl: 'https://v2api.top/v1' },
    },
    permissionMode: 'auto',
  }),
} as unknown as SettingsStore;

async function setup() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvas = createCanvasStore(handle);
  const session = await sessions.create('s', null, null);
  const c = canvas.ensureCanvas(session.id);
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-img-edit-'));
  return { canvas, canvasId: c.id, dataRoot };
}

describe('runImageNode edit branch', () => {
  beforeEach(() => {
    generateImageMock.mockReset();
    generateImageMock.mockResolvedValue({
      images: [{ uint8Array: new Uint8Array(PNG), mediaType: 'image/png' }],
    });
  });

  it('assembles buildEditPrompt text and source/mask bytes', async () => {
    const { canvas, canvasId, dataRoot } = await setup();
    const src = canvas.addNode(canvasId, {
      type: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: 'src', size: '1024x1024' },
    }).node;
    const dir = canvasAssetsDir(dataRoot, canvasId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'src.png'), PNG);
    await writeFile(path.join(dir, 'mask.png'), PNG);
    canvas.updateNode(canvasId, src.id, { runState: 'done', output: { assets: [`${canvasId}/src.png`] } });

    const editSpec = {
      kind: 'inpaint' as const,
      sourceNodeId: src.id,
      maskAsset: `${canvasId}/mask.png`,
      instruction: '换成红色气球',
    };
    const editNode = canvas.addNode(canvasId, {
      type: 'image',
      x: 200,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: '', size: '1024x1024', edit: editSpec },
    }).node;
    canvas.addEdge(canvasId, { sourceId: src.id, targetId: editNode.id, sourceHandle: 'image_out', targetHandle: 'edit_src' });

    await runImageNode({
      canvasStore: canvas,
      settingsStore,
      dataRoot,
      canvasId,
      node: canvas.getNode(canvasId, editNode.id)!,
    });

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    const arg = generateImageMock.mock.calls[0][0] as {
      prompt: { text: string; images: Uint8Array[] };
    };
    expect(arg.prompt.text).toBe(buildEditPrompt(editSpec));
    expect(arg.prompt.images).toHaveLength(2);
    expect(Buffer.from(arg.prompt.images[0]).equals(PNG)).toBe(true);
    expect(Buffer.from(arg.prompt.images[1]).equals(PNG)).toBe(true);

    const done = canvas.getNode(canvasId, editNode.id);
    expect(done?.runState).toBe('done');
    expect(done?.output?.assets?.length).toBeGreaterThan(0);
  });

  it('errors when the edit node has no source image', async () => {
    const { canvas, canvasId, dataRoot } = await setup();
    const editNode = canvas.addNode(canvasId, {
      type: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: {
        prompt: '',
        size: '1024x1024',
        edit: { kind: 'matting', sourceNodeId: 'missing' },
      },
    }).node;

    await runImageNode({
      canvasStore: canvas,
      settingsStore,
      dataRoot,
      canvasId,
      node: editNode,
    });

    expect(generateImageMock).not.toHaveBeenCalled();
    expect(canvas.getNode(canvasId, editNode.id)?.runState).toBe('error');
    expect(canvas.getNode(canvasId, editNode.id)?.output?.error).toMatch(/源图/);
  });
});
