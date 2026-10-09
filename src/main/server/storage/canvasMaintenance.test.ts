import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createCanvasStore } from './canvasStore';
import { createSqliteSessionStore } from './sqliteSessionStore';
import { createCanvasMaintenance } from './canvasMaintenance';

async function fixture() {
  const handle = openDb(':memory:');
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('maintenance fixture', null, null);
  const store = createCanvasStore(handle);
  const canvasId = store.ensureCanvas(session.id).id;
  const root = mkdtempSync(path.join(os.tmpdir(), 'reizo-maintenance-fixture-'));
  const canvasDir = path.join(root, 'canvas', canvasId); mkdirSync(canvasDir, { recursive: true });
  const clock = Date.now() + 2 * 24 * 60 * 60_000;
  const maintenance = createCanvasMaintenance(handle, root, () => clock);
  const file = (name: string) => { writeFileSync(path.join(canvasDir, name), `fixture ${name}`); return `${canvasId}/${name}`; };
  const close = () => { handle.close(); if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir())) rmSync(root, { recursive: true, force: true }); };
  return { handle, store, canvasId, root, canvasDir, maintenance, file, close };
}

it('protects legacy masks, retained outputs/jobs/receipts/refs and registered history; isolates only explicit orphans and restores bytes', async () => {
  const f = await fixture();
  try {
    const legacy = f.file('legacy.png'); const mask = f.file('mask.png'); const history = f.file('history.png');
    const input = f.file('job-input.png'); const result = f.file('job-result.png'); const receipt = f.file('receipt.png');
    const spilled = f.file('spilled.png'); const registered = f.file('registered.png'); const orphan = f.file('orphan.png');
    // Node's Windows utimes wraps negative dates into 2106; only POSIX can create this fixture.
    if (process.platform !== 'win32') utimesSync(path.join(f.root, 'canvas', orphan), new Date(-10_000), new Date(-10_000));
    f.file('.asset-fixture-fixture.part'); f.file('manual label.png');
    const node = f.store.addNode(f.canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: { edit: { maskAsset: mask } } }).node;
    f.store.updateNode(f.canvasId, node.id, { output: { assets: [history] } });
    f.store.updateNode(f.canvasId, node.id, { output: { assets: [legacy] } });
    const job = f.store.jobs.enqueue({ canvasId: f.canvasId, nodeId: node.id, nodeType: 'image', input: { source: input } });
    f.store.jobs.finish(job.id, 'succeeded', { result: { assets: [result] } });
    f.store.saveReceipt(f.canvasId, 'maintenance-reference', 'fixture', { path: receipt });
    f.store.assets.register({ id: 'registered-history', path: registered, canvasId: f.canvasId, nodeId: node.id, kind: 'image', mimeType: 'image/png',
      byteSize: 1, contentHash: createHash('sha256').update('fixture').digest('hex'), source: 'imported' });
    const encoded = f.file('encoded.png');
    mkdirSync(path.join(f.root, 'refs')); writeFileSync(path.join(f.root, 'refs', 'tool-output'), `Historical output: ${spilled}. 100% complete: /api/canvas/assets/${encoded.replace('.png', '%2Epng')}`);
    const nestedReference = f.file('metadata-reference.png');
    writeFileSync(path.join(f.canvasDir, 'notes.json'), JSON.stringify({ image: nestedReference }));
    const scan = f.maintenance.scan();
    expect(scan.referencesComplete).toBe(true);
    for (const relative of [legacy, mask, history, input, result, receipt, spilled, registered, nestedReference, encoded]) expect(scan.files.find((file) => file.path === relative)?.status).toBe('protected');
    expect(scan.files.filter((file) => file.status === 'candidate').map((file) => file.path)).toEqual([orphan]);
    await expect(f.maintenance.quarantine(scan.token, [registered], 'protected')).rejects.toThrow('候选');
    const before = readFileSync(path.join(f.root, 'canvas', orphan));
    const isolated = await f.maintenance.quarantine(scan.token, [orphan], 'isolate');
    expect(existsSync(path.join(f.root, 'canvas', orphan))).toBe(false);
    expect(await f.maintenance.quarantine(scan.token, [orphan], 'isolate')).toEqual(isolated);
    expect(f.maintenance.list()).toEqual([isolated]);
    const interruptedDir = path.join(f.root, 'canvas-quarantine', 'a'.repeat(64));
    mkdirSync(interruptedDir); writeFileSync(path.join(interruptedDir, '.manifest-fixture.tmp'), '{unfinished');
    expect(f.maintenance.list()).toEqual([isolated]);
    const damagedDir = path.join(f.root, 'canvas-quarantine', 'b'.repeat(64));
    mkdirSync(damagedDir); writeFileSync(path.join(damagedDir, '0.blob'), 'retained for manual review');
    expect(f.maintenance.list().find((batch) => batch.id === isolated.id)).toEqual(isolated);
    expect(f.maintenance.list().find((batch) => batch.id === 'b'.repeat(64))?.reviewReason).toBeTruthy();
    const restored = await f.maintenance.restore(isolated.id, [orphan]);
    expect(restored.files[0].status).toBe('restored');
    expect(readFileSync(path.join(f.root, 'canvas', orphan))).toEqual(before);
    await expect(f.maintenance.restore(isolated.id, [orphan])).resolves.toEqual(restored);
  } finally { f.close(); }
}, 20_000);

it('rejects stale candidates with new refs, refuses restore collisions/traversal, and never follows directory links', async () => {
  const f = await fixture();
  const outside = mkdtempSync(path.join(os.tmpdir(), 'reizo-maintenance-outside-'));
  try {
    const orphan = f.file('orphan.png'); const scan = f.maintenance.scan();
    const node = f.store.addNode(f.canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100 }).node;
    f.store.updateNode(f.canvasId, node.id, { output: { assets: [orphan] } });
    await expect(f.maintenance.quarantine(scan.token, [orphan], 'new-ref')).rejects.toThrow('新增引用');
    expect(existsSync(path.join(f.root, 'canvas', orphan))).toBe(true);
    const free = f.file('free.png'); const isolated = await f.maintenance.quarantine(f.maintenance.scan().token, [free], 'free');
    writeFileSync(path.join(f.root, 'canvas', free), 'new owner');
    await expect(f.maintenance.restore(isolated.id, [free])).rejects.toThrow('不会覆盖');
    expect(readFileSync(path.join(f.root, 'canvas', free), 'utf8')).toBe('new owner');
    await expect(f.maintenance.restore(isolated.id, ['../escape.png'])).rejects.toThrow('恢复清单');
    writeFileSync(path.join(outside, 'untouched.png'), 'outside');
    symlinkSync(outside, path.join(f.root, 'canvas', 'linked-canvas'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(f.maintenance.scan().files.find((file) => file.path === 'linked-canvas')?.status).toBe('review');
    expect(readFileSync(path.join(outside, 'untouched.png'), 'utf8')).toBe('outside');
    f.handle.raw.prepare('UPDATE canvas_nodes SET params_json = ? WHERE id = ?').run('{broken', node.id);
    const incomplete = f.maintenance.scan();
    expect(incomplete.referencesComplete).toBe(false);
    expect(incomplete.files.every((file) => file.status !== 'candidate')).toBe(true);
  } finally {
    f.close(); if (path.dirname(path.resolve(outside)) === path.resolve(os.tmpdir())) rmSync(outside, { recursive: true, force: true });
  }
}, 20_000);
