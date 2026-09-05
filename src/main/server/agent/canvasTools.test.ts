import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { createSettingsStore } from '../storage/settingsStore';
import { createCanvasTools } from './canvasTools';

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

async function setup() {
  const handle = openDb(':memory:');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reizo-test-'));
  const sessions = createSqliteSessionStore(handle);
  const canvasStore = createCanvasStore(handle);
  const settingsStore = createSettingsStore(tmpDir);
  const session = await sessions.create('test-session', null, null);
  const tools = createCanvasTools({
    sessionId: session.id,
    canvasStore,
    settingsStore,
    dataRoot: './data-test',
  });
  return { tools, canvasStore, sessionId: session.id };
}

describe('canvasTools', () => {
  it('enforces port compatibility and returns descriptive error on incompatible connect_nodes', async () => {
    const { tools, canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const grp = canvasStore.addNode(canvas.id, { type: 'group', x: 0, y: 0, w: 100, h: 100, params: {} }).node;
    const img = canvasStore.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: {} }).node;

    // Agent connect_nodes cannot wire a group container
    const res = (await (tools.connect_nodes as any).execute({
      source: grp.id,
      target: img.id,
    })) as { error?: string };
    expect(res).toHaveProperty('error');
    expect(res.error).toContain('Port incompatible');
  });

  it('supports sourceHandle, targetHandle, and operationId on valid connect_nodes', async () => {
    const { tools, canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const img = canvasStore.addNode(canvas.id, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: {} }).node;
    const vid = canvasStore.addNode(canvas.id, { type: 'video', x: 0, y: 0, w: 100, h: 100, params: {} }).node;

    const res = (await (tools.connect_nodes as any).execute({
      source: img.id,
      target: vid.id,
      targetHandle: 'start_frame',
      operationId: 'op-123',
    })) as { edgeId?: string; operationId?: string };
    expect(res.edgeId).toBeTruthy();
    expect(res.operationId).toBe('op-123');
  });

  it('marks node as proposal and preserves operationId on add_node', async () => {
    const { tools } = await setup();
    const res = (await (tools.add_node as any).execute({
      type: 'image',
      prompt: 'A futuristic city',
      asProposal: true,
      operationId: 'op-add-node',
    })) as { id?: string; asProposal?: boolean; operationId?: string };
    expect(res.id).toBeTruthy();
    expect(res.asProposal).toBe(true);
    expect(res.operationId).toBe('op-add-node');
  });

  it('creates full storyboard pipeline with asProposal and operationId', async () => {
    const { tools } = await setup();
    const res = (await (tools.create_storyboard_pipeline as any).execute({
      storyTitle: '赛博朋克追逐战',
      ratio: '16:9',
      scenes: [
        {
          title: '幕 1：雨夜起步',
          script: '主角启动磁悬浮机车冲入霓虹街道',
          imagePrompt: 'Cyberpunk rain neon street motorcycle hero',
          videoPrompt: 'Fast dolly in following motorcycle through rainy street',
          camera: 'zoom_in',
          duration: '5s',
        },
      ],
      asProposal: true,
      operationId: 'op-storyboard',
    })) as { ok?: boolean; asProposal?: boolean; operationId?: string; createdNodeIds?: string[] };
    expect(res.ok).toBe(true);
    expect(res.asProposal).toBe(true);
    expect(res.operationId).toBe('op-storyboard');
    expect(res.createdNodeIds).toHaveLength(2); // 1 image + 1 video
  });
});
