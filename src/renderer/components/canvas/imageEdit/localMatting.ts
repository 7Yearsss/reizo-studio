import { getResolvedApiOrigin, canvasAssetUrlSync } from '../../../api';
import * as canvasStore from '../../../state/canvasStore';
import type { CanvasNode } from '../../../../shared/canvas';

// Local background removal: u2netp (ISNet-lite, ~4.7MB) run through
// onnxruntime-web in the renderer. Both the model and the WASM binaries are
// served by the local Hono server (/api/matting/*) so this works identically in
// dev and packaged builds. Everything is lazy — the model is fetched on first
// use and the session is cached. Any failure rejects so callers can fall back
// to the remote (AI) matting path.

const INPUT = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type Ort = typeof import('onnxruntime-web');
let sessionPromise: Promise<import('onnxruntime-web').InferenceSession> | null = null;

async function session(): Promise<import('onnxruntime-web').InferenceSession> {
  sessionPromise ??= (async () => {
    const ort: Ort = await import('onnxruntime-web');
    const origin = getResolvedApiOrigin() ?? 'http://127.0.0.1:47100';
    ort.env.wasm.wasmPaths = `${origin}/api/matting/ort/`;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const res = await fetch(`${origin}/api/matting/model`);
    if (!res.ok) throw new Error(`model fetch failed: ${res.status}`);
    const bytes = await res.arrayBuffer();
    return ort.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  })();
  return sessionPromise;
}

function letterboxToInput(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = INPUT;
  cv.height = INPUT;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, INPUT, INPUT);
  const scale = Math.min(INPUT / w, INPUT / h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const dx = Math.round((INPUT - dw) / 2);
  const dy = Math.round((INPUT - dh) / 2);
  ctx.drawImage(src, dx, dy, dw, dh);
  return cv;
}

function toTensor(imageData: ImageData): Float32Array {
  const { data } = imageData;
  const out = new Float32Array(3 * INPUT * INPUT);
  const plane = INPUT * INPUT;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    out[i] = (r - MEAN[0]) / STD[0];
    out[plane + i] = (g - MEAN[1]) / STD[1];
    out[2 * plane + i] = (b - MEAN[2]) / STD[2];
  }
  return out;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
  return img;
}

/** Returns an RGBA PNG blob with the background made transparent. */
export async function segmentImageBlob(imageUrl: string): Promise<Blob> {
  const [sess, img] = await Promise.all([session(), loadImage(imageUrl)]);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('image has no size');

  const lb = letterboxToInput(img, w, h);
  const imageData = lb.getContext('2d')?.getImageData(0, 0, INPUT, INPUT);
  if (!imageData) throw new Error('readback failed');
  const ort: Ort = await import('onnxruntime-web');
  const feeds: Record<string, import('onnxruntime-web').Tensor> = {};
  const input = new ort.Tensor('float32', toTensor(imageData), [1, 3, INPUT, INPUT]);
  feeds[sess.inputNames[0]] = input;
  const results = await sess.run(feeds);
  const out = results[sess.outputNames[0]];
  const pred = out.data as Float32Array;

  // min-max normalize the saliency map to 0..1
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of pred) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;

  // draw the mask back over the letterboxed image, then crop the scaled-down
  // subject region back up to full-res alpha
  const mask = document.createElement('canvas');
  mask.width = INPUT;
  mask.height = INPUT;
  const mctx = mask.getContext('2d');
  if (!mctx) throw new Error('no 2d context');
  const maskData = mctx.createImageData(INPUT, INPUT);
  for (let i = 0; i < INPUT * INPUT; i++) {
    const a = Math.max(0, Math.min(255, Math.round(((pred[i] - lo) / range) * 255)));
    maskData.data[i * 4 + 3] = a;
  }
  mctx.putImageData(maskData, 0, 0);

  const composited = document.createElement('canvas');
  composited.width = INPUT;
  composited.height = INPUT;
  const cctx = composited.getContext('2d');
  if (!cctx) throw new Error('no 2d context');
  cctx.drawImage(lb, 0, 0);
  cctx.globalCompositeOperation = 'destination-in';
  cctx.drawImage(mask, 0, 0);

  // crop the letterbox back to the original aspect and scale up
  const scale = Math.min(INPUT / w, INPUT / h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const dx = Math.round((INPUT - dw) / 2);
  const dy = Math.round((INPUT - dh) / 2);
  const out2 = document.createElement('canvas');
  out2.width = w;
  out2.height = h;
  const octx = out2.getContext('2d');
  if (!octx) throw new Error('no 2d context');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(composited, dx, dy, dw, dh, 0, 0, w, h);

  return new Promise<Blob>((resolve, reject) => {
    out2.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png');
  });
}

/**
 * Run matting for an image node: local ONNX first (free, ~seconds), remote AI
 * edit as fallback when the model can't load. Used by every entry point that
 * triggers 抠图 so they all get the same local-first behavior.
 */
export async function runMatting(sessionId: string, node: CanvasNode): Promise<void> {
  const rel = node.output?.assets?.[node.output.activeAssetIndex ?? 0] ?? node.output?.assets?.[0];
  const url = rel ? canvasAssetUrlSync(rel) : null;
  if (url) {
    try {
      const blob = await segmentImageBlob(url);
      await canvasStore.deriveImageEdit(sessionId, node.id, { kind: 'matting' }, { localResultBlob: blob });
      return;
    } catch {
      // fall through to the remote path
    }
  }
  await canvasStore.deriveImageEdit(sessionId, node.id, { kind: 'matting' });
}
