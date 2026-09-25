import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';

// Local background-removal assets: the onnxruntime-web WASM binaries (served
// from node_modules in dev, from packaged resources later) and the u2netp
// saliency model, downloaded once into <dataRoot>/models and cached.
// The renderer loads both over HTTP so file:// and bundling never matter.

const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx';
const MODEL_NAME = 'u2netp.onnx';
const ORT_FILE_RE = /^[\w.-]+\.(wasm|mjs)$/;

function ortDistDir(): string | null {
  const candidates = [
    process.env.REIZO_ORT_DIR,
    // Packaged builds: forge copies the needed ort-wasm-* files flat into
    // resources/ (see extraResource in forge.config.ts).
    process.resourcesPath,
    // Dev: served straight out of node_modules.
    path.resolve(process.cwd(), 'node_modules/onnxruntime-web/dist'),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    // Probe for an actual wasm file — under Electron dev, process.resourcesPath
    // exists (Electron's own resources dir) but contains none of ours.
    if (dir && existsSync(path.join(dir, 'ort-wasm-simd-threaded.wasm'))) return dir;
  }
  return null;
}

export function createMattingRouter(dataRoot: string) {
  const router = new Hono();
  const modelsDir = path.join(dataRoot, 'models');
  let downloadPromise: Promise<Buffer> | null = null;

  async function loadModel(): Promise<Buffer> {
    const cached = path.join(modelsDir, MODEL_NAME);
    try {
      return await readFile(cached);
    } catch {
      // fall through to download
    }
    downloadPromise ??= (async () => {
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`model download failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 1_000_000) throw new Error('model download truncated');
      await mkdir(modelsDir, { recursive: true });
      await writeFile(cached, buf);
      return buf;
    })();
    try {
      return await downloadPromise;
    } finally {
      // allow a later retry after a failed download
      downloadPromise = null;
    }
  }

  router.get('/model', async (c) => {
    try {
      const buf = await loadModel();
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/octet-stream',
          'cache-control': 'private, max-age=31536000',
        },
      });
    } catch {
      return c.json({ error: 'matting model unavailable' }, 503);
    }
  });

  router.get('/ort/:file', (c) => {
    const file = c.req.param('file');
    if (!ORT_FILE_RE.test(file)) return c.json({ error: 'bad file' }, 400);
    const dir = ortDistDir();
    if (!dir) return c.json({ error: 'ort assets unavailable' }, 503);
    const full = path.join(dir, file);
    if (!full.startsWith(dir) || !existsSync(full)) return c.json({ error: 'not found' }, 404);
    const type = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, {
      headers: { 'content-type': type, 'cache-control': 'private, max-age=31536000' },
    });
  });

  return router;
}
