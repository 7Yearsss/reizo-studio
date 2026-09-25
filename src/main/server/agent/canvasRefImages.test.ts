import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { inlineCanvasRefImages, referencedImageNodeIds } from './canvasRefImages';

describe('referencedImageNodeIds', () => {
  it('picks finished image nodes from the referenced-nodes block only', () => {
    const content = [
      '帮我做一套电商套图',
      '',
      'Referenced canvas nodes:',
      '- abc_1 [image, done] 商品.png',
      '- vid2 [video, done] clip',
      '- pend3 [image, running] draft',
    ].join('\n');
    expect(referencedImageNodeIds(content)).toEqual(['abc_1']);
    expect(referencedImageNodeIds('- abc_1 [image, done] no block header')).toEqual([]);
  });
});

describe('inlineCanvasRefImages', () => {
  it('attaches the referenced image bytes to the latest user message', async () => {
    const handle = openDb(':memory:');
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reizo-refimg-'));
    const session = await createSqliteSessionStore(handle).create('s', null, null);
    const canvasStore = createCanvasStore(handle);
    const canvas = canvasStore.ensureCanvas(session.id);
    const rel = `${canvas.id}/product.png`;
    fs.mkdirSync(path.join(dataRoot, 'canvas', canvas.id), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'canvas', rel), Buffer.from([1, 2, 3]));
    const node = canvasStore.addNode(canvas.id, {
      type: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      title: '商品.png',
      params: {},
    }).node;
    canvasStore.updateNode(canvas.id, node.id, { runState: 'done', output: { assets: [rel] } });

    const text = `做套图\n\nReferenced canvas nodes:\n- ${node.id} [image, done] 商品.png`;
    const history: ModelMessage[] = [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: text },
    ];
    await inlineCanvasRefImages(history, { canvasStore, sessionId: session.id, dataRoot });

    expect(history[0].content).toBe('earlier');
    const last = history[2];
    expect(Array.isArray(last.content)).toBe(true);
    const parts = last.content as Array<{ type: string; text?: string; data?: Uint8Array; mediaType?: string }>;
    expect(parts[0]).toEqual({ type: 'text', text });
    const image = parts.find((p) => p.type === 'file');
    expect(image?.mediaType).toBe('image/png');
    expect(Array.from(image?.data ?? [])).toEqual([1, 2, 3]);
  });
});
