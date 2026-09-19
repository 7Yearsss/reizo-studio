import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { createCanvasRouter } from './canvas';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(async ({ prompt }: { prompt: string }) => ({
      text: `\`\`\`\n专业的提示词：${prompt}，电影级光影，景深丰富\n\`\`\``,
    })),
  };
});

vi.mock('../agent/provider/openai', () => ({
  createOpenAiModel: vi.fn(() => ({})),
}));

describe('POST /api/canvas/refine-prompt', () => {
  const settingsStore = {
    get: async () => ({
      activeProviderId: 'openai',
      providers: {
        openai: { apiKey: 'sk-test', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
      },
    }),
  } as unknown as SettingsStore;

  it('refines an image prompt and removes code fences', async () => {
    const handle = openDb(':memory:');
    const sessions = createSqliteSessionStore(handle);
    const canvasStore = createCanvasStore(handle);
    const app = new Hono().route('/api/canvas', createCanvasRouter(canvasStore, settingsStore, sessions, ''));

    const res = await app.request('/api/canvas/refine-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '赛博朋克 雨夜飞车', mode: 'image' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { refined: string };
    expect(body.refined).toBe('专业的提示词：赛博朋克 雨夜飞车，电影级光影，景深丰富');
  });

  it('rejects empty prompts with 400', async () => {
    const handle = openDb(':memory:');
    const sessions = createSqliteSessionStore(handle);
    const canvasStore = createCanvasStore(handle);
    const app = new Hono().route('/api/canvas', createCanvasRouter(canvasStore, settingsStore, sessions, ''));

    const res = await app.request('/api/canvas/refine-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ', mode: 'video' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('提示词内容不能为空');
  });

  it('returns 400 when active provider has no apiKey', async () => {
    const emptySettings = {
      get: async () => ({
        activeProviderId: 'openai',
        providers: {
          openai: { apiKey: null as string | null },
        },
      }),
    } as unknown as SettingsStore;

    const handle = openDb(':memory:');
    const sessions = createSqliteSessionStore(handle);
    const canvasStore = createCanvasStore(handle);
    const app = new Hono().route('/api/canvas', createCanvasRouter(canvasStore, emptySettings, sessions, ''));

    const res = await app.request('/api/canvas/refine-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '猫咪', mode: 'image' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('API Key');
  });
});
