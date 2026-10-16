import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createCanvasStore } from '../storage/canvasStore';
import { readCanvasAsset, stageCanvasAssets } from '../canvas/assets';
import { EditorMediaExchange } from './mediaExchange';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'reizo-editor-media-'));
  const db = openDb(':memory:');
  const sessions = createSqliteSessionStore(db);
  const a = await sessions.create('A', null, null); const b = await sessions.create('B', null, null);
  const store = createCanvasStore(db); const canvas = store.ensureCanvas(a.id);
  const exchange = new EditorMediaExchange(root, store);
  cleanup.push(async () => { exchange.stop(); db.close(); await rm(root, { recursive: true, force: true }); });
  const staged = await stageCanvasAssets(root, canvas.id, [{ name: 'source.mp4', mimeType: 'video/mp4', kind: 'video', bytes: Buffer.from('original immutable source') }]);
  staged.prepareCommit();
  const asset = store.assets.register({ ...staged.files[0], canvasId: canvas.id, source: 'imported' }); staged.keep();
  return { root, store, exchange, a, b, asset, canvas };
}
async function waitJob(exchange: EditorMediaExchange, session: string) {
  for (let i = 0; i < 100; i++) {
    const job = exchange.jobs(session, 'project-a')[0]; if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Import did not queue');
}
it('transfers one exact version, deduplicates concurrent requests, and isolates receipts and files', async () => {
  const f = await fixture();
  const first = f.exchange.import(f.a.id, 'project-a', f.asset.id);
  const second = f.exchange.import(f.a.id, 'project-a', f.asset.id);
  const job = await waitJob(f.exchange, f.a.id);
  expect(f.exchange.jobs(f.a.id, 'project-a')).toHaveLength(1);
  expect(f.exchange.jobs(f.b.id, 'project-a')).toEqual([]);
  expect(() => f.exchange.file(f.b.id, job.id)).toThrow('不属于');
  expect(() => f.exchange.complete(f.b.id, job.id, { error: 'cancel' })).toThrow('不属于');
  expect(() => f.exchange.complete(f.a.id, job.id, { asset: { sourceAssetId: 'wrong', editorAssetId: 'new', name: 'source' } })).toThrow('回执');
  expect(f.exchange.file(f.a.id, job.id).toString()).toBe('original immutable source');
  const result = { sourceAssetId: f.asset.id, editorAssetId: 'editor-asset', name: job.name };
  // Let both readers join the same pending job before acknowledging it.
  await new Promise((resolve) => setTimeout(resolve, 30));
  f.exchange.complete(f.a.id, job.id, { asset: result });
  expect(await first).toEqual(result); expect(await second).toEqual(result);
  expect(f.exchange.jobs(f.a.id, 'project-a')).toEqual([]);
});
it('rejects unshared cross-conversation assets and changed file bytes', async () => {
  const f = await fixture();
  f.store.ensureCanvas(f.b.id);
  await expect(f.exchange.import(f.b.id, 'project-b', f.asset.id)).rejects.toThrow('不在当前对话');
  await writeFile(path.join(f.root, 'canvas', f.asset.path), 'changed');
  await expect(f.exchange.import(f.a.id, 'project-a', f.asset.id)).rejects.toThrow('版本不一致');
  expect(f.exchange.jobs(f.a.id, 'project-a')).toEqual([]);
});
it('propagates import failure and shutdown instead of reporting successful transfer', async () => {
  const f = await fixture();
  const pending = f.exchange.import(f.a.id, 'project-a', f.asset.id);
  const failed = expect(pending).rejects.toThrow('解析失败');
  const job = await waitJob(f.exchange, f.a.id);
  f.exchange.complete(f.a.id, job.id, { error: '解析失败' });
  await failed;
  const retry = f.exchange.import(f.a.id, 'project-a', f.asset.id);
  const stopped = expect(retry).rejects.toThrow('已关闭');
  await waitJob(f.exchange, f.a.id); f.exchange.stop();
  await stopped;
  expect(f.exchange.jobs(f.a.id, 'project-a')).toEqual([]);
});
it('publishes durable output and provenance once even with concurrent or restarted delivery', async () => {
  const f = await fixture();
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(30)]);
  const [a, b] = await Promise.all([
    f.exchange.saveExport(f.a.id, 'project-a', '成片.mp4', bytes),
    f.exchange.saveExport(f.a.id, 'project-a', '成片.mp4', bytes),
  ]);
  expect(a.id).toBe(b.id); expect(a.tags).toEqual(['OpenChatCut', 'project-a']);
  expect(a.folder).toBe('剪辑成片');
  expect(await readCanvasAsset(f.root, a.path)).toEqual(bytes);
  expect(f.store.getNodes(f.canvas.id)).toHaveLength(1);
  const restarted = new EditorMediaExchange(f.root, f.store);
  f.store.assets.updateMetadata(a.id, { tags: ['用户自定义标签'], name: '我的作品' });
  expect((await restarted.saveExport(f.a.id, 'project-a', '成片.mp4', bytes)).id).toBe(a.id);
  await expect(f.exchange.saveExport(f.a.id, 'project-a', 'wrong.mp4', Buffer.from('not media'))).rejects.toThrow('仅支持');
  expect(f.store.getNodes(f.canvas.id)).toHaveLength(1);
});

it('saves local image sources once, retains their bytes, and does not accept them as video exports', async () => {
  const f = await fixture();
  const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(30)]);
  const a = await f.exchange.saveExport(f.a.id, 'project-a', '选中图片.png', bytes, 'source');
  const b = await f.exchange.saveExport(f.a.id, 'project-a', '重命名.png', bytes, 'source');
  expect(a.id).toBe(b.id); expect(a.folder).toBe('剪辑素材'); expect(a.kind).toBe('image');
  expect(await readCanvasAsset(f.root, a.path)).toEqual(bytes);
  f.store.assets.updateMetadata(a.id, { tags: [], folder: '用户目录' });
  expect((await f.exchange.saveExport(f.a.id, 'project-a', '选中图片.png', bytes, 'source')).id).toBe(a.id);
  await expect(f.exchange.saveExport(f.a.id, 'project-a', '选中图片.png', bytes)).rejects.toThrow('仅支持');
  await expect(f.exchange.saveExport(f.a.id, 'project-a', 'fake.png', Buffer.from('not image'), 'source')).rejects.toThrow('格式');
});
