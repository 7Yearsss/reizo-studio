import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Hono } from 'hono';
import { createVoiceModelStore } from '../voice/modelStore';
import { VOICE_MODEL } from '../../../shared/voiceInput';

function runtimeDir() {
  if (process.env.REIZO_VOICE_RUNTIME) return process.env.REIZO_VOICE_RUNTIME;
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const fromTransformers = createRequire(require.resolve('@huggingface/transformers'));
  return path.dirname(fromTransformers.resolve('onnxruntime-web'));
}

export function createVoiceRouter(dataRoot: string) {
  const store = createVoiceModelStore(dataRoot, fetch, process.env.REIZO_VOICE_MODEL || (process.env.REIZO_VOICE_RUNTIME ? undefined : path.resolve('.cache/local-asr-models')));
  const router = new Hono();
  router.get('/status', async c => c.json(await store.status()));
  router.post('/prepare', async c => {
    try { await store.prepare(); return c.json(await store.status()); }
    catch { return c.json({ error: (await store.status()).error || '模型准备失败' }, 503); }
  });
  router.get('/models/*', async c => {
    const prefix = `/models/${VOICE_MODEL}/`;
    const relative = c.req.path.slice(c.req.path.indexOf('/models/'));
    if (!relative.startsWith(prefix)) return c.notFound();
    const file = relative.slice(prefix.length);
    const bytes = await store.read(file);
    if (!bytes) return c.notFound();
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Cache-Control': 'no-store' } });
  });
  router.get('/runtime/:name', async c => {
    const name = c.req.param('name');
    if (!['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'].includes(name)) return c.notFound();
    try { return new Response(new Uint8Array(await readFile(path.join(runtimeDir(), name))), { headers: { 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' } }); }
    catch { return c.json({ error: '语音运行资源缺失，请重新安装应用' }, 503); }
  });
  return router;
}
