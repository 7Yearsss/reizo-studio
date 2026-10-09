import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { serve } from '@hono/node-server';
import { createApp } from '../src/main/server/app';
import { openDb } from '../src/main/server/db/client';
import { createSqliteSessionStore } from '../src/main/server/storage/sqliteSessionStore';
import { createCanvasStore } from '../src/main/server/storage/canvasStore';
import { nanoid } from 'nanoid';
import { canvasFixtureImage } from './canvas-fixture-image';

async function main() {
  const tempRoot = path.resolve(os.tmpdir());
  const dataRoot = await mkdtemp(path.join(tempRoot, 'reizo-ui-preview-'));
  const handle = openDb(path.join(dataRoot, 'preview.db'));
  const sessions = createSqliteSessionStore(handle);
  const session = await sessions.create('交互验收 · 临时画布', null, null);
  const app = createApp({ dataRoot, db: handle, sessionStore: sessions, port: 47160, devServerOrigin: 'http://127.0.0.1:47161', skillsDirs: [path.resolve('skills')] });
  const stopToken = nanoid();
  app.get('/_preview/capture', (context) => {
    if (context.req.query('token') !== stopToken) return context.text('Forbidden', 403);
    return context.html(`<html lang="zh-CN"><meta charset="utf-8"><title>本地验收截图保存</title><form method="post"><input type="hidden" name="token" value="${stopToken}"><label>截图名称<input name="name" required pattern="[a-z0-9-]{1,64}"></label><label>图像数据<textarea name="image" required></textarea></label><button>保存截图</button></form></html>`);
  });
  app.post('/_preview/capture', async (context) => {
    const body = await context.req.parseBody();
    if (body.token !== stopToken) return context.text('Forbidden', 403);
    if (typeof body.name !== 'string' || !/^[a-z0-9-]{1,64}$/.test(body.name) || typeof body.image !== 'string' || body.image.length > 3 * 1024 * 1024)
      return context.text('Invalid screenshot', 400);
    const bytes = Buffer.from(body.image, 'base64');
    const extension = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg'
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : undefined;
    if (!extension || !bytes.length || bytes.length > 2 * 1024 * 1024) return context.text('Invalid screenshot', 400);
    const directory = path.resolve('artifacts', 'canvas-qa-20261003');
    await mkdir(directory, { recursive: true });
    const saved = path.join(directory, `${body.name}.${extension}`);
    await writeFile(saved, bytes, { flag: 'wx' });
    return context.html(`<html lang="zh-CN"><meta charset="utf-8"><title>截图已保存</title><p role="status">截图已保存</p><code id="saved-path">${saved.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></html>`);
  });
  app.post('/_preview/stop', async (context) => {
    if (context.req.header('X-Preview-Token') !== stopToken) return context.json({ error: 'Forbidden' }, 403);
    setTimeout(() => server.close(async () => {
      app.stopCanvasJobs(); handle.close();
      if (path.dirname(path.resolve(dataRoot)) === tempRoot) await rm(dataRoot, { recursive: true, force: true });
      process.exit(0);
    }), 100);
    return context.json({ ok: true });
  });
  const store = createCanvasStore(handle);
  const canvasId = store.ensureCanvas(session.id).id;
  for (let i = 0; i < 3; i++) {
    const png = canvasFixtureImage(i === 1 ? 640 : 256, i === 1 ? 360 : 320, i).toString('base64');
    const response = await app.request(`http://127.0.0.1:47160/api/canvas/${canvasId}/edits`, { method: 'POST',
      headers: { host: '127.0.0.1:47160', 'content-type': 'application/json', 'Idempotency-Key': `fixture-${i}` }, body: JSON.stringify({
        edits: [{ kind: 'add_node', id: `fixture-${i}`, node: { type: 'image', title: ['商品正面', '品牌封面', '待补跑镜头'][i], x: i * 380, y: 120, params: { prompt: 'fixture' } } }],
        uploads: [{ nodeId: `fixture-${i}`, name: ['产品标准图', '已确认封面', '镜头参考'][i], dataBase64: png, mimeType: 'image/png' }],
      }) });
    if (response.status !== 200) throw new Error(await response.text());
  }
  const assets = store.assets.list(canvasId);
  store.assets.updateMetadata(assets[0].id, { folder: '商品', tags: ['产品', '参考'] });
  const node = store.getNode(canvasId, 'fixture-2');
  const job = store.jobs.enqueue({ canvasId, nodeId: node.id, nodeType: 'image', input: { node }, providerId: 'fixture', model: 'test-model' });
  store.jobs.finish(job.id, 'interrupted', { error: '任务因应用退出而中断，原素材已保留。', cancelReason: 'restart' });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 47160 });
  console.log(JSON.stringify({ origin: 'http://127.0.0.1:47160', sessionId: session.id, stopToken, pid: process.pid }));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
