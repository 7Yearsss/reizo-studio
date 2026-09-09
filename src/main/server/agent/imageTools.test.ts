import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { SettingsStore } from '../storage/settingsStore';

const generateImageMock = vi.fn();

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateImage: (opts: unknown) => generateImageMock(opts),
  };
});

vi.mock('../canvas/imageExecutor', () => ({
  runImageNode: vi.fn(async () => undefined),
}));

import { createImageTools } from './imageTools';
import { createCanvasStore } from '../storage/canvasStore';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { openDb } from '../db/client';
import { runImageNode } from '../canvas/imageExecutor';

describe('imageTools', () => {
  it('defines generate_image tool with correct schema and description', () => {
    const tools = createImageTools({
      settingsStore: {} as SettingsStore,
      dataRoot: 'test',
    });
    expect(tools.generate_image).toBeDefined();
    expect(tools.generate_image.description).toContain('在当前对话中直接生成并展示图片');
  });

  it('fails gracefully when no API key is configured', async () => {
    const settingsStore = {
      get: async () => ({
        activeProviderId: 'reizo',
        providers: {},
      }),
    } as unknown as SettingsStore;

    const tools = createImageTools({
      settingsStore,
      dataRoot: 'test',
    });

    const res = await (tools.generate_image.execute as any)({
      prompt: 'a cute cat',
      size: '1024x1024',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('请先在系统设置中配置 API Key');
  });

  it('successfully generates image with gpt-image-2 and writes to disk', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'reizo-img-test-'));

    try {
      const settingsStore = {
        get: async () => ({
          activeProviderId: 'reizo',
          providers: {
            reizo: {
              apiKey: 'sk-test-reizo',
              baseUrl: 'https://v2api.top/v1',
            },
          },
        }),
      } as unknown as SettingsStore;

      generateImageMock.mockResolvedValueOnce({
        images: [
          {
            base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            uint8Array: new Uint8Array([1, 2, 3]),
            mediaType: 'image/png',
          },
        ],
      });

      const tools = createImageTools({
        settingsStore,
        dataRoot: tmpDir,
      });

      const res = await (tools.generate_image.execute as any)({
        prompt: 'a cyberpunk skyline',
        size: '1024x1024',
      });

      expect(res.ok).toBe(true);
      expect(res.model).toBe('gpt-image-2');
      expect(res.imageUrl).toMatch(/^\/api\/canvas\/assets\/chat\/img-.*\.png$/);
      expect(res.prompt).toBe('a cyberpunk skyline');
      expect(generateImageMock).toHaveBeenCalled();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('defines canvas_edit_image and derives a matting node from a source image', async () => {
    const handle = openDb(':memory:');
    const sessions = createSqliteSessionStore(handle);
    const canvasStore = createCanvasStore(handle);
    const session = await sessions.create('s', null, null);
    const canvas = canvasStore.ensureCanvas(session.id);
    const src = canvasStore.addNode(canvas.id, {
      type: 'image',
      x: 0,
      y: 0,
      w: 320,
      h: 380,
      params: { prompt: 'globe', size: '1024x1024' },
    }).node;
    canvasStore.updateNode(canvas.id, src.id, { runState: 'done', output: { assets: [`${canvas.id}/src.png`] } });

    const tools = createImageTools({
      settingsStore: {
        get: async () => ({ activeProviderId: 'reizo', providers: { reizo: { apiKey: 'sk' } } }),
      } as unknown as SettingsStore,
      dataRoot: 'test',
      sessionId: session.id,
      canvasStore,
    });

    const res = (await (tools.canvas_edit_image.execute as any)({
      nodeId: src.id,
      kind: 'matting',
    })) as { ok: boolean; id: string; kind: string };

    expect(res.ok).toBe(true);
    expect(res.kind).toBe('matting');
    const created = canvasStore.getNode(canvas.id, res.id);
    expect((created?.params as { edit?: { kind: string; sourceNodeId: string } }).edit).toMatchObject({
      kind: 'matting',
      sourceNodeId: src.id,
    });
    const snap = canvasStore.getSnapshot(canvas.id);
    expect(snap?.edges.some((e) => e.sourceId === src.id && e.targetId === res.id && e.targetHandle === 'edit_src')).toBe(
      true,
    );
    expect(runImageNode).toHaveBeenCalled();
  });

  it('rejects canvas_edit_image when the source has no image', async () => {
    const handle = openDb(':memory:');
    const sessions = createSqliteSessionStore(handle);
    const canvasStore = createCanvasStore(handle);
    const session = await sessions.create('s', null, null);
    const canvas = canvasStore.ensureCanvas(session.id);
    const src = canvasStore.addNode(canvas.id, {
      type: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: '', size: '1024x1024' },
    }).node;

    const tools = createImageTools({
      settingsStore: {} as SettingsStore,
      dataRoot: 'test',
      sessionId: session.id,
      canvasStore,
    });
    const res = (await (tools.canvas_edit_image.execute as any)({
      nodeId: src.id,
      kind: 'relight',
      params: { colorTempK: 3000 },
    })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/还没有生成/);
  });
});
