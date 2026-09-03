import { describe, expect, it, vi } from 'vitest';

const streamTextMock = vi.fn();

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: (opts: unknown) => streamTextMock(opts) };
});

import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { runAgentNode } from './agentExecutor';

const settingsStore = {
  get: async () => ({
    activeProviderId: 'openai',
    providers: { openai: { apiKey: 'k', model: 'gpt-x', baseUrl: 'https://api.openai.com/v1' } },
    permissionMode: 'auto',
  }),
} as unknown as SettingsStore;

async function freshCanvas() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvas = createCanvasStore(handle);
  const session = await sessions.create('s', null, null);
  const c = canvas.ensureCanvas(session.id);
  return { canvas, canvasId: c.id };
}

function fakeStream(chunks: string[]) {
  return {
    textStream: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    text: Promise.resolve(chunks.join('')),
  };
}

describe('runAgentNode', () => {
  it('errors without running when the node has no instruction', async () => {
    const { canvas, canvasId } = await freshCanvas();
    const node = canvas.addNode(canvasId, { type: 'agent', x: 0, y: 0, w: 1, h: 1, params: { instruction: '  ' } }).node;

    await runAgentNode({ canvasStore: canvas, settingsStore, canvasId, node });

    const after = canvas.getNode(canvasId, node.id);
    expect(after?.runState).toBe('error');
    expect(after?.output?.error).toMatch(/instruction/i);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('streams the answer into output.text and clears dirty on success', async () => {
    streamTextMock.mockReturnValueOnce(fakeStream(['Hel', 'lo ', 'world']));
    const { canvas, canvasId } = await freshCanvas();
    const node = canvas.addNode(canvasId, {
      type: 'agent',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      params: { instruction: 'summarise' },
    }).node;

    await runAgentNode({ canvasStore: canvas, settingsStore, canvasId, node });

    const after = canvas.getNode(canvasId, node.id);
    expect(after?.runState).toBe('done');
    expect(after?.output?.text).toBe('Hello world');
    expect(after?.paramsHash).toBeTruthy();
    expect(after?.dirty ?? false).toBe(false);
  });

  it('feeds an upstream agent node result into the prompt', async () => {
    streamTextMock.mockReturnValueOnce(fakeStream(['ok']));
    const { canvas, canvasId } = await freshCanvas();
    const up = canvas.addNode(canvasId, {
      type: 'agent',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      params: { instruction: 'gather facts' },
    }).node;
    canvas.updateNode(canvasId, up.id, { runState: 'done', output: { text: 'the sky is blue' } });
    const down = canvas.addNode(canvasId, {
      type: 'agent',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      params: { instruction: 'critique the above' },
    }).node;
    canvas.addEdge(canvasId, { sourceId: up.id, targetId: down.id });
    const downFresh = canvas.getNode(canvasId, down.id);
    if (!downFresh) throw new Error('down node missing');

    await runAgentNode({ canvasStore: canvas, settingsStore, canvasId, node: downFresh });

    const opts = streamTextMock.mock.calls.at(-1)?.[0] as { messages: { content: string }[] };
    expect(opts.messages[0].content).toContain('critique the above');
    expect(opts.messages[0].content).toContain('the sky is blue');
  });

  it('reports a provider error as node error state', async () => {
    streamTextMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const { canvas, canvasId } = await freshCanvas();
    const node = canvas.addNode(canvasId, {
      type: 'agent',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      params: { instruction: 'do a thing' },
    }).node;

    await runAgentNode({ canvasStore: canvas, settingsStore, canvasId, node });

    expect(canvas.getNode(canvasId, node.id)?.runState).toBe('error');
    expect(canvas.getNode(canvasId, node.id)?.output?.error).toBe('boom');
  });

  it('supplies image vision parts when an upstream image node has assets', async () => {
    streamTextMock.mockReturnValueOnce(fakeStream(['looks great']));
    const { canvas, canvasId } = await freshCanvas();
    const imageNode = canvas.addNode(canvasId, {
      type: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: 'a beautiful sunset' },
    }).node;
    canvas.updateNode(canvasId, imageNode.id, {
      runState: 'done',
      output: { assets: [`${canvasId}/sunset.png`] },
    });

    const agentNode = canvas.addNode(canvasId, {
      type: 'agent',
      x: 200,
      y: 0,
      w: 100,
      h: 100,
      params: { instruction: 'critique lighting' },
    }).node;
    canvas.addEdge(canvasId, { sourceId: imageNode.id, targetId: agentNode.id });

    const imgMod = await import('./imageExecutor');
    const readSpy = vi.spyOn(imgMod, 'readCanvasAsset').mockResolvedValueOnce(Buffer.from([1, 2, 3]));

    const freshAgent = canvas.getNode(canvasId, agentNode.id);
    if (!freshAgent) throw new Error('missing');

    await runAgentNode({
      canvasStore: canvas,
      settingsStore,
      dataRoot: '/fake/root',
      canvasId,
      node: freshAgent,
    });

    expect(readSpy).toHaveBeenCalledWith('/fake/root', `${canvasId}/sunset.png`);
    const opts = streamTextMock.mock.calls.at(-1)?.[0] as {
      messages: { content: Array<{ type: string; text?: string; image?: Uint8Array; mediaType?: string }> }[];
    };
    expect(Array.isArray(opts.messages[0].content)).toBe(true);
    expect(opts.messages[0].content[0].type).toBe('text');
    expect(opts.messages[0].content[0].text).toContain('critique lighting');
    expect(opts.messages[0].content[1].type).toBe('image');
    expect(opts.messages[0].content[1].mediaType).toBe('image/png');
    expect(opts.messages[0].content[1].image).toEqual(new Uint8Array([1, 2, 3]));
  });
});
