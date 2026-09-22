import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { createSettingsStore } from '../storage/settingsStore';
import { createCanvasTools } from './canvasTools';
import { runVideoNode } from '../canvas/videoExecutor';

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
  const { tools } = createCanvasTools({
    sessionId: session.id,
    canvasStore,
    settingsStore,
    dataRoot: tmpDir,
  });
  return { tools, canvasStore, settingsStore, sessionId: session.id, tmpDir };
}

function seedMediaNode(
  canvasStore: ReturnType<typeof createCanvasStore>,
  canvasId: string,
  assets: string[],
) {
  const node = canvasStore.addNode(canvasId, {
    type: 'image',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    params: { prompt: 'latest prompt' },
  }).node;
  canvasStore.updateNode(canvasId, node.id, {
    runState: 'done',
    output: {
      assets,
      resultSet: assets.map((asset, i) => ({ asset, createdAt: `2026-01-0${i + 1}`, prompt: `prompt v${i}` })),
      activeAssetIndex: 0,
    },
  });
  return node.id;
}

describe('select_node_version', () => {
  it('switches the active version by index', async () => {
    const { tools, canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const id = seedMediaNode(canvasStore, canvas.id, ['a/c1.mp4', 'a/c2.mp4', 'a/c3.mp4']);

    const res = (await (tools.select_node_version as any).execute({ nodeId: id, versionIndex: 2 })) as {
      ok?: boolean;
      activeAssetIndex?: number;
      versionCount?: number;
    };
    expect(res.ok).toBe(true);
    expect(res.activeAssetIndex).toBe(2);
    expect(res.versionCount).toBe(3);
    expect(canvasStore.getNode(canvas.id, id)?.output?.activeAssetIndex).toBe(2);
  });

  it('rolls back to the immediately previous version', async () => {
    const { tools, canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const id = seedMediaNode(canvasStore, canvas.id, ['a/c1.png', 'a/c2.png']);
    canvasStore.updateNode(canvas.id, id, { output: { ...canvasStore.getNode(canvas.id, id)!.output!, activeAssetIndex: 0 } });

    const res = (await (tools.select_node_version as any).execute({ nodeId: id, rollbackToPrevious: true })) as {
      ok?: boolean;
      activeAssetIndex?: number;
    };
    expect(res.ok).toBe(true);
    expect(res.activeAssetIndex).toBe(1);
  });

  it('rejects out-of-range indices', async () => {
    const { tools, canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const id = seedMediaNode(canvasStore, canvas.id, ['a/c1.png', 'a/c2.png']);

    const res = (await (tools.select_node_version as any).execute({ nodeId: id, versionIndex: 5 })) as {
      error?: string;
    };
    expect(res.error).toContain('越界');
  });

  it('restores the recorded prompt when restorePrompt is set', async () => {
    const { tools, canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const id = seedMediaNode(canvasStore, canvas.id, ['a/c1.png', 'a/c2.png']);

    const res = (await (tools.select_node_version as any).execute({
      nodeId: id,
      versionIndex: 1,
      restorePrompt: true,
    })) as { ok?: boolean; restoredPrompt?: string };
    expect(res.ok).toBe(true);
    expect(res.restoredPrompt).toBe('prompt v1');
    const params = canvasStore.getNode(canvas.id, id)?.params as { prompt?: string };
    expect(params.prompt).toBe('prompt v1');
  });

  it('errors when the node has no versions', async () => {
    const { tools, canvasStore, sessionId } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const node = canvasStore.addNode(canvas.id, {
      type: 'image',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: {},
    }).node;

    const res = (await (tools.select_node_version as any).execute({ nodeId: node.id, versionIndex: 0 })) as {
      error?: string;
    };
    expect(res.error).toBeTruthy();
  });
});

describe('video node version accumulation (mock driver)', () => {
  it('appends a new version to assets/resultSet instead of wiping them', async () => {
    const { canvasStore, settingsStore, sessionId, tmpDir } = await setup();
    const canvas = canvasStore.ensureCanvas(sessionId);
    const node = canvasStore.addNode(canvas.id, {
      type: 'video',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      params: { prompt: 'shot one', duration: '5s' },
    }).node;
    // Pretend a previous generation already landed.
    canvasStore.updateNode(canvas.id, node.id, {
      runState: 'done',
      output: {
        assets: [`${canvas.id}/old.mp4`],
        resultSet: [{ asset: `${canvas.id}/old.mp4`, createdAt: '2026-01-01', prompt: 'old prompt' }],
        activeAssetIndex: 0,
      },
    });

    await runVideoNode({
      canvasStore,
      settingsStore,
      dataRoot: tmpDir,
      canvasId: canvas.id,
      node,
      providerId: 'mock',
    });

    const deadline = Date.now() + 15_000;
    let out = canvasStore.getNode(canvas.id, node.id)?.output;
    while (canvasStore.getNode(canvas.id, node.id)?.runState !== 'done' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      out = canvasStore.getNode(canvas.id, node.id)?.output;
    }
    expect(canvasStore.getNode(canvas.id, node.id)?.runState).toBe('done');
    expect(out?.assets?.length).toBe(2);
    expect(out?.assets?.[1]).toBe(`${canvas.id}/old.mp4`);
    expect(out?.resultSet?.length).toBe(2);
    expect(out?.resultSet?.[0].prompt).toBe('shot one');
    expect(out?.resultSet?.[0].model).toBe('mock');
    expect(out?.activeAssetIndex).toBe(0);
  }, 30_000);
});
