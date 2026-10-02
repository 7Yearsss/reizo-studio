import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
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
  it('preserves masks, historical bytes and both mention forms while assigning imported asset identities', async () => {
    const { canvas, dataRoot, newCanvas } = await scaffold();
    const source = await newCanvas(); const target = await newCanvas();
    const base = canvas.addNode(source.id, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'source' } }).node;
    const current = await seedAsset(dataRoot, source.id, 'current.png', Buffer.from('current'));
    const history = await seedAsset(dataRoot, source.id, 'history.png', Buffer.from('history'));
    const mask = await seedAsset(dataRoot, source.id, 'mask.png', Buffer.from('mask'));
    canvas.assets.register({ id: 'source-fixed-history', canvasId: source.id, nodeId: base.id, path: history,
      kind: 'image', mimeType: 'image/png', byteSize: 7, contentHash: createHash('sha256').update('history').digest('hex'), source: 'imported' });
    canvas.updateNode(source.id, base.id, { output: { assets: [current], resultSet: [{ asset: current }, { asset: history, assetId: 'foreign-asset', jobId: 'foreign-job', generation: 8, providerId: 'foreign-provider' }] }, runState: 'done' });
    const edited = canvas.addNode(source.id, { type: 'image', x: 100, y: 0, w: 100, h: 100, params: {
      prompt: 'Use @[source](canvas:' + base.id + ') and @#' + base.id.slice(0, 8),
      edit: { kind: 'inpaint', sourceNodeId: base.id, maskAsset: mask },
    } }).node;
    canvas.addEdge(source.id, { sourceId: base.id, targetId: edited.id, targetHandle: 'edit_src' });
    const anchor = canvas.addNode(source.id, { type: 'anchor', x: 0, y: 200, w: 100, h: 100,
      params: { assetId: 'source-fixed-history', role: 'content', strength: 'mid' } }).node;
    // The registry identity wins over stale display output, just as it does at job admission.
    canvas.updateNode(source.id, anchor.id, { runState: 'done', output: { assets: [current] } });
    const zip = await exportWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: source.id });
    const originalEntries = unzipSync(zip);
    const manifest = JSON.parse(strFromU8(originalEntries['workflow.json']));
    const packedAnchor = manifest.nodes.find((node: { type: string }) => node.type === 'anchor');
    expect(packedAnchor.params.assetId).toBeUndefined();
    expect(packedAnchor.params.assetRef).toBe(packedAnchor.output.assets[0]);
    const imported = await importWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: target.id, zip, operationId: 'portable-import' });
    const restored = canvas.getNode(target.id, imported.nodeIds[0]);
    const restoredEdit = canvas.getNode(target.id, imported.nodeIds[1]);
    const restoredAnchor = canvas.getNode(target.id, imported.nodeIds[2]);
    const restoredAnchorParams = restoredAnchor.params as { assetId: string };
    const params = restoredEdit.params as { prompt: string; edit: { sourceNodeId: string; maskAsset: string } };
    expect(params.prompt).toContain('](canvas:' + restored.id + ')');
    expect(params.prompt).toContain('@#' + restored.id.slice(0, 8));
    expect(params.edit.sourceNodeId).toBe(restored.id);
    expect((await readFile(path.join(dataRoot, 'canvas', params.edit.maskAsset))).toString()).toBe('mask');
    const version = restored.output.resultSet[1];
    expect((await readFile(path.join(dataRoot, 'canvas', version.asset))).toString()).toBe('history');
    expect(version.jobId).toBeUndefined(); expect(version.providerId).toBeUndefined();
    expect(canvas.assets.get(version.assetId)).toMatchObject({ source: 'imported', canvasId: target.id });
    expect(restoredAnchor.params).toMatchObject({ assetId: version.assetId, role: 'content', strength: 'mid' });
    expect(restoredAnchor.params).not.toHaveProperty('assetRef');
    expect(restoredAnchor.output.assets).toEqual([version.asset]);
    expect(restoredAnchorParams.assetId).not.toBe('source-fixed-history');
    const repeated = await importWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: target.id, zip, operationId: 'portable-import' });
    expect(repeated).toEqual(imported); expect(canvas.getSnapshot(target.id)?.nodes).toHaveLength(3);
    expect(canvas.assets.list(target.id)).toHaveLength(3);
    const exported = unzipSync(await exportWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: target.id }));
    expect(Object.keys(exported).filter((name) => name.startsWith('assets/'))).toHaveLength(3);
    // Earlier v1 archives retained the source local ID; selected archived bytes must still get a fresh identity.
    packedAnchor.params.assetId = 'source-fixed-history';
    delete packedAnchor.params.assetRef;
    const legacyTarget = await newCanvas();
    const legacy = await importWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: legacyTarget.id,
      zip: zipSync({ ...originalEntries, 'workflow.json': strToU8(JSON.stringify(manifest)) }) });
    const legacyAnchor = canvas.getNode(legacyTarget.id, legacy.nodeIds[2]);
    const legacyAnchorParams = legacyAnchor.params as { assetId: string };
    expect(legacyAnchorParams.assetId).not.toBe('source-fixed-history');
    expect(canvas.assets.get(legacyAnchorParams.assetId)).toMatchObject({ canvasId: legacyTarget.id, source: 'imported' });
    expect((await readFile(path.join(dataRoot, 'canvas', legacyAnchor.output.assets[0]))).toString()).toBe('history');
  });

  it('rolls document, metadata and newly staged files back together if restoring output fails', async () => {
    const { canvas, dataRoot, newCanvas } = await scaffold();
    const source = await newCanvas(); const target = await newCanvas();
    const node = canvas.addNode(source.id, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
    const file = await seedAsset(dataRoot, source.id, 'original.png', Buffer.from('bytes'));
    canvas.updateNode(source.id, node.id, { runState: 'done', output: { assets: [file] } });
    const zip = await exportWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: source.id });
    const before = canvas.getSnapshot(target.id);
    const update = canvas.updateNode;
    canvas.updateNode = () => { throw new Error('restore failure'); };
    try { await expect(importWorkflowZip({ canvasStore: canvas, dataRoot, canvasId: target.id, zip })).rejects.toThrow('restore failure'); }
    finally { canvas.updateNode = update; }
    expect(canvas.getSnapshot(target.id)).toEqual(before);
    expect(canvas.assets.list(target.id)).toEqual([]);
    expect(await readdir(path.join(dataRoot, 'canvas', target.id))).toEqual([]);
  });

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
