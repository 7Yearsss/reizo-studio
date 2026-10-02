import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CanvasAssetRegisterInput } from '../../../shared/canvasAssets';
import { openDb, type DbHandle } from '../db/client';
import { MIGRATIONS } from '../db/migrations';
import { createSqliteSessionStore } from './sqliteSessionStore';
import { createCanvasStore } from './canvasStore';

const handles = new Set<DbHandle>();
const dirs: string[] = [];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
afterEach(() => {
  for (const handle of handles) handle.close(); handles.clear();
  for (const dir of dirs.splice(0)) if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir())) rmSync(dir, { recursive: true });
});

async function fixture() {
  const handle = openDb(':memory:'); handles.add(handle);
  const store = createCanvasStore(handle);
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('assets', null, null);
  const canvasId = store.ensureCanvas(session.id).id;
  const node = store.addNode(canvasId, { type: 'image', x: 0, y: 0, w: 100, h: 100, params: { prompt: 'cup' } }).node;
  const job = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: { prompt: 'cup' }, inputHash: 'saved-input-hash' });
  store.jobs.markSubmitted(job.id, { providerId: 'actual-provider', model: 'actual-model' });
  const input: CanvasAssetRegisterInput = {
    id: 'generated-asset', path: `${canvasId}/generated.png`, canvasId, nodeId: node.id, jobId: job.id,
    kind: 'image', mimeType: 'image/png', byteSize: 3, contentHash: hash('png'), source: 'generated',
  };
  return { handle, store, sessions, session, canvasId, node, job, input };
}

describe('immutable canvas asset metadata', () => {
  it('upgrades a pre-asset file database, preserves legacy paths, and reopens explicitly registered metadata', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reizo-asset-upgrade-')); dirs.push(dir);
    const dbPath = path.join(dir, 'sessions.db');
    const old = new DatabaseSync(dbPath);
    try {
      old.exec('CREATE TABLE __migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
      for (const migration of MIGRATIONS.filter((entry) => entry.name <= '0007_canvas_remote_tasks')) {
        for (const statement of migration.statements) old.exec(statement);
        old.prepare('INSERT INTO __migrations VALUES (?, ?)').run(migration.name, 1);
      }
      old.exec(`INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('session', 'legacy', 1, 1);
        INSERT INTO canvases (id, session_id, created_at, updated_at) VALUES ('canvas', 'session', 1, 1);
        INSERT INTO canvas_nodes (id, canvas_id, type, x, y, w, h, run_state, output_json, updated_at)
        VALUES ('node', 'canvas', 'image', 0, 0, 100, 100, 'done', '{"assets":["canvas/legacy.png"]}', 1)`);
    } finally { old.close(); }
    const handle = openDb(dbPath); handles.add(handle);
    const store = createCanvasStore(handle);
    expect(store.getSnapshot('canvas')?.nodes[0].output?.assets).toEqual(['canvas/legacy.png']);
    expect(store.assets.findByPath('canvas/legacy.png')).toBeNull();
    expect(store.assets.list('canvas')).toEqual([]);
    const input: CanvasAssetRegisterInput = { id: 'legacy-import', path: 'canvas/legacy.png', canvasId: 'canvas', nodeId: 'node', kind: 'image', mimeType: 'image/png', byteSize: 6, contentHash: hash('legacy'), source: 'imported' };
    const saved = store.assets.register(input);
    handle.close(); handles.delete(handle);
    const reopened = openDb(dbPath); handles.add(reopened);
    const restored = createCanvasStore(reopened);
    expect(restored.assets.get(saved.id)).toEqual(saved);
    expect(restored.assets.findByPath(saved.path)).toEqual(saved);
    expect(restored.assets.register(input)).toEqual(saved);
    expect(reopened.raw.prepare('SELECT name FROM __migrations WHERE name = ?').get('0008_canvas_assets')).toBeTruthy();
  });

  it('registers generated provenance from the owning job and rolls back metadata, output and terminal outcome together', async () => {
    const f = await fixture();
    const before = f.store.getSnapshot(f.canvasId);
    expect(() => f.store.assets.register(f.input)).toThrow('outer transaction');
    expect(f.store.assets.get(f.input.id)).toBeNull();
    const commit = () => {
      const asset = f.store.assets.register(f.input);
      const output = { assets: [asset.path], resultSet: [{ asset: asset.path, assetId: asset.id, jobId: asset.jobId, generation: asset.generation, providerId: asset.providerId, model: asset.model, inputHash: asset.inputHash }] };
      f.store.updateNode(f.canvasId, f.node.id, { runState: 'done', output });
      expect(f.store.jobs.finish(f.job.id, 'succeeded', { result: output })).toBe(true);
      return asset;
    };
    expect(() => f.store.transaction(() => { commit(); throw new Error('projection failed'); })).toThrow('projection failed');
    expect(f.store.assets.get(f.input.id)).toBeNull();
    expect(f.store.getSnapshot(f.canvasId)).toEqual(before);
    expect(f.store.jobs.get(f.job.id)?.status).toBe('running');
    const asset = f.store.transaction(commit);
    expect(asset).toMatchObject({ jobId: f.job.id, generation: 1, providerId: 'actual-provider', model: 'actual-model', inputHash: 'saved-input-hash' });
    expect(f.store.getNode(f.canvasId, f.node.id)?.output?.resultSet?.[0]).toMatchObject({ assetId: asset.id, jobId: f.job.id, generation: 1 });
    expect(f.store.assets.register(f.input)).toEqual(asset);
    for (const changed of [
      { ...f.input, contentHash: hash('different') }, { ...f.input, byteSize: 4 }, { ...f.input, mimeType: 'image/jpeg' },
      { ...f.input, id: 'different-id' }, { ...f.input, path: `${f.canvasId}/different.png` },
    ]) expect(() => f.store.assets.register(changed)).toThrow('immutable metadata');
    expect(() => f.store.transaction(() => f.store.assets.register({ ...f.input, id: 'late-result', path: `${f.canvasId}/late.png` }))).toThrow('no longer owns');
    expect(() => f.store.assets.register({ ...f.input, providerId: 'forged-provider' } as CanvasAssetRegisterInput)).toThrow('file metadata only');
    expect(f.store.assets.list(f.canvasId)).toEqual([asset]);
  });

  it('retains immutable origin/job history after node and canvas deletion while rejecting fresh invalid or stale registrations', async () => {
    const f = await fixture();
    const wrong = { ...f.input, id: 'wrong-kind', path: `${f.canvasId}/wrong.mp4`, kind: 'video' as const, mimeType: 'video/mp4' };
    expect(() => f.store.transaction(() => f.store.assets.register(wrong))).toThrow('does not match its job');
    expect(() => f.store.assets.register({ ...f.input, path: '../escape.png' })).toThrow('canvas-scoped');
    const generated = f.store.transaction(() => {
      const asset = f.store.assets.register(f.input);
      f.store.jobs.finish(f.job.id, 'succeeded', { result: { assets: [asset.path] } });
      return asset;
    });
    const importedInput: CanvasAssetRegisterInput = { ...f.input, id: 'imported-asset', path: `${f.canvasId}/imported.png`, jobId: undefined, source: 'imported' };
    const imported = f.store.assets.register(importedInput);
    f.store.deleteNode(f.canvasId, f.node.id);
    expect(f.store.assets.get(generated.id)).toEqual(generated);
    expect(f.store.assets.register(f.input)).toEqual(generated);
    await f.sessions.remove(f.session.id);
    expect(f.store.getCanvas(f.canvasId)).toBeNull(); expect(f.store.jobs.get(f.job.id)).toBeNull();
    expect(f.store.assets.list(f.canvasId)).toEqual([generated, imported]);
    expect(f.store.assets.register(f.input)).toEqual(generated);
    expect(f.store.assets.register(importedInput)).toEqual(imported);
    expect(() => f.store.assets.register({ ...importedInput, id: 'new-record', path: `${f.canvasId}/new.png` })).toThrow('origin canvas not found');
  });
});
