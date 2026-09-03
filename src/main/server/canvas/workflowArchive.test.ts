import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { exportWorkflowZip, WORKFLOW_VERSION } from './exportWorkflow';
import { importWorkflowZip } from './importWorkflow';

async function scaffold() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const canvas = createCanvasStore(handle);
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-wf-'));
  const newCanvas = async () => {
    const session = await sessions.create('s', null, null);
    return canvas.ensureCanvas(session.id);
  };
  return { canvas, dataRoot, newCanvas };
}

/** Write a fake asset for `canvasId` and return its stored rel path. */
async function seedAsset(dataRoot: string, canvasId: string, name: string, bytes: Buffer) {
  const dir = path.join(dataRoot, 'canvas', canvasId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return `${canvasId}/${name}`;
}

describe('workflow archive round-trip', () => {
  it('exports nodes/edges/assets and re-imports them with fresh ids', async () => {
    const { canvas, dataRoot, newCanvas } = await scaffold();
    const c = await newCanvas();

    const img = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 320, h: 380, title: '关键帧', params: { prompt: 'a cat' } });
    const vid = canvas.addNode(c.id, { type: 'video', x: 400, y: 0, w: 340, h: 420, title: '运镜', params: { prompt: 'pan' } });
    const rel = await seedAsset(dataRoot, c.id, `${img.node.id}-x.png`, Buffer.from('PNGDATA'));
    canvas.updateNode(c.id, img.node.id, { runState: 'done', output: { assets: [rel] } });
    canvas.addEdge(c.id, { sourceId: img.node.id, targetId: vid.node.id, targetHandle: 'start_frame' });

    const zip = await exportWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: c.id, title: 'demo' });
    const entries = unzipSync(zip);
    const manifest = JSON.parse(strFromU8(entries['workflow.json']));
    expect(manifest.version).toBe(WORKFLOW_VERSION);
    expect(manifest.nodes).toHaveLength(2);
    expect(manifest.edges).toHaveLength(1);
    // asset path rewritten to content-addressed form
    const assetKeys = Object.keys(entries).filter((k) => k.startsWith('assets/'));
    expect(assetKeys).toHaveLength(1);
    expect(manifest.nodes.find((n: { type: string }) => n.type === 'image').output.assets[0]).toBe(assetKeys[0]);

    // Import into a *different* canvas.
    const target = await newCanvas();
    const result = await importWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: target.id, zip });
    expect(result.nodeIds).toHaveLength(2);
    expect(result.edgeIds).toHaveLength(1);

    const snap = canvas.getSnapshot(target.id)!;
    expect(snap.nodes).toHaveLength(2);
    expect(snap.edges).toHaveLength(1);
    // new ids, not the originals
    expect(snap.nodes.map((n) => n.id)).not.toContain(img.node.id);
    // edge endpoints are remapped to the new node ids
    expect(snap.edges[0].sourceId).toBe(snap.nodes.find((n) => n.type === 'image')!.id);
    expect(snap.edges[0].targetHandle).toBe('start_frame');
    // asset bytes were unpacked and the node points at a real file
    const importedRel = snap.nodes.find((n) => n.type === 'image')!.output?.assets?.[0];
    expect(importedRel).toBeTruthy();
    expect(importedRel!.startsWith(`${target.id}/`)).toBe(true);
    const bytes = await readFile(path.join(dataRoot, 'canvas', importedRel!));
    expect(bytes.toString()).toBe('PNGDATA');
  });

  it('remaps group memberIds to the new node ids', async () => {
    const { canvas, dataRoot, newCanvas } = await scaffold();
    const c = await newCanvas();
    const a = canvas.addNode(c.id, { type: 'image', x: 0, y: 0, w: 320, h: 380, params: { prompt: 'a' } });
    const b = canvas.addNode(c.id, { type: 'image', x: 360, y: 0, w: 320, h: 380, params: { prompt: 'b' } });
    canvas.addNode(c.id, {
      type: 'group',
      x: -30,
      y: -40,
      w: 760,
      h: 480,
      title: '第一幕',
      params: { memberIds: [a.node.id, b.node.id], color: '#3b82f6', locked: false },
    });

    const zip = await exportWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: c.id });
    const target = await newCanvas();
    await importWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: target.id, zip });

    const snap = canvas.getSnapshot(target.id)!;
    const group = snap.nodes.find((n) => n.type === 'group')!;
    const memberIds = (group.params as { memberIds: string[] }).memberIds;
    const liveIds = new Set(snap.nodes.map((n) => n.id));
    expect(memberIds).toHaveLength(2);
    expect(memberIds.every((id) => liveIds.has(id))).toBe(true);
    expect(memberIds).not.toContain(a.node.id);
  });

  it('rejects an incompatible manifest version', async () => {
    const { canvas, dataRoot, newCanvas } = await scaffold();
    const target = await newCanvas();
    const badZip = (await import('fflate')).zipSync({
      'workflow.json': (await import('fflate')).strToU8(JSON.stringify({ version: 999, nodes: [], edges: [] })),
    });
    await expect(
      importWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: target.id, zip: badZip }),
    ).rejects.toThrow(/版本不兼容/);
  });

  it('rejects a corrupt zip', async () => {
    const { canvas, dataRoot, newCanvas } = await scaffold();
    const target = await newCanvas();
    await expect(
      importWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: target.id, zip: new Uint8Array([1, 2, 3, 4]) }),
    ).rejects.toThrow();
  });
});

afterEach(() => {
  /* mkdtemp dirs are OS-tmp; left for the OS to reap */
});
