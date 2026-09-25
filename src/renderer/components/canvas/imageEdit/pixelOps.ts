import { pixelCropRect, splitGridRects } from '../../../../shared/canvasImageEdit';

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('导出 PNG 失败'));
    }, 'image/png');
  });
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

export async function cropImageBlob(
  src: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<Blob> {
  const img = await loadHtmlImage(src);
  const { sx, sy, sw, sh } = pixelCropRect(img.naturalWidth, img.naturalHeight, rect);
  const canvas = makeCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToPngBlob(canvas);
}

export async function resizeImageBlob(src: string, targetW: number, targetH: number): Promise<Blob> {
  const img = await loadHtmlImage(src);
  const canvas = makeCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToPngBlob(canvas);
}

export async function splitImageBlobs(src: string, grid: '2x2' | '3x3' | '4x4'): Promise<Blob[]> {
  const out: Blob[] = [];
  for (const rect of splitGridRects(grid)) {
    out.push(await cropImageBlob(src, rect));
  }
  return out;
}

export async function compositeOverlayBlob(src: string, overlay: HTMLCanvasElement): Promise<Blob> {
  const img = await loadHtmlImage(src);
  const canvas = makeCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  return canvasToPngBlob(canvas);
}

/** 翻转 + 90° 倍数旋转。rotateDeg 归一化到 [0,360)。 */
export async function transformImageBlob(
  src: string,
  opts: { flipH?: boolean; flipV?: boolean; rotateDeg?: number },
): Promise<Blob> {
  const img = await loadHtmlImage(src);
  const deg = ((opts.rotateDeg ?? 0) % 360 + 360) % 360;
  const swap = deg === 90 || deg === 270;
  const canvas = makeCanvas(swap ? img.naturalHeight : img.naturalWidth, swap ? img.naturalWidth : img.naturalHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
  return canvasToPngBlob(canvas);
}

export interface AdjustSpec {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  /** 0..1，映射为 sepia 暖调强度。 */
  warmth?: number;
  hueDeg?: number;
}

export function adjustCssFilter(spec: AdjustSpec): string {
  const parts: string[] = [];
  if (spec.brightness !== undefined && spec.brightness !== 1) parts.push(`brightness(${spec.brightness})`);
  if (spec.contrast !== undefined && spec.contrast !== 1) parts.push(`contrast(${spec.contrast})`);
  if (spec.saturation !== undefined && spec.saturation !== 1) parts.push(`saturate(${spec.saturation})`);
  if (spec.warmth) parts.push(`sepia(${Math.min(0.4, spec.warmth * 0.4)})`);
  if (spec.hueDeg) parts.push(`hue-rotate(${spec.hueDeg}deg)`);
  return parts.join(' ') || 'none';
}

export async function adjustImageBlob(src: string, spec: AdjustSpec): Promise<Blob> {
  const img = await loadHtmlImage(src);
  const canvas = makeCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.filter = adjustCssFilter(spec);
  ctx.drawImage(img, 0, 0);
  return canvasToPngBlob(canvas);
}

/**
 * 马赛克：mask 白区（不透明）内的像素块化，其余逐像素保留。
 * blockRatio 为块边长占最短边的比例。
 */
export async function mosaicImageBlob(src: string, mask: HTMLCanvasElement, blockRatio = 0.02): Promise<Blob> {
  const img = await loadHtmlImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const block = Math.max(2, Math.round(Math.min(w, h) * blockRatio));

  const small = makeCanvas(Math.ceil(w / block), Math.ceil(h / block));
  const sctx = small.getContext('2d');
  if (!sctx) throw new Error('无法创建画布');
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(img, 0, 0, small.width, small.height);

  const pixelated = makeCanvas(w, h);
  const pctx = pixelated.getContext('2d');
  if (!pctx) throw new Error('无法创建画布');
  pctx.imageSmoothingEnabled = false;
  pctx.drawImage(small, 0, 0, w, h);
  // 仅保留 mask 不透明区
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(mask, 0, 0, w, h);
  pctx.globalCompositeOperation = 'source-over';

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.drawImage(img, 0, 0);
  ctx.drawImage(pixelated, 0, 0);
  return canvasToPngBlob(canvas);
}

/**
 * A transparent-background scratch canvas for painting a selection. Selected
 * pixels are drawn opaque white; unselected stay transparent (so the coloured
 * on-screen tint can be built by compositing, and the exported PNG composites
 * onto black for the model). Never pre-fill it black.
 */
export function createMaskCanvas(width: number, height: number): HTMLCanvasElement {
  return makeCanvas(width, height);
}

/** Flatten a white-on-transparent mask onto an opaque black background PNG. */
export function maskToBlackWhitePng(mask: HTMLCanvasElement, blurPx = 0): Promise<Blob> {
  const c = makeCanvas(mask.width, mask.height);
  const ctx = c.getContext('2d');
  if (!ctx) return canvasToPngBlob(mask);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(mask, 0, 0);
  ctx.filter = 'none';
  return canvasToPngBlob(c);
}

/**
 * Flatten several white-on-transparent region masks onto one black PNG, each
 * region painted in its own colour. The model reads colour → per-region
 * instruction (see `buildEditPrompt`).
 */
export function regionsToMaskPng(
  regions: Array<{ canvas: HTMLCanvasElement; color: string }>,
  w: number,
  h: number,
  blurPx = 0,
): Promise<Blob> {
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  const scratch = makeCanvas(w, h);
  const sctx = scratch.getContext('2d');
  if (!ctx || !sctx) throw new Error('无法创建画布');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  for (const { canvas, color } of regions) {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(canvas, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = color;
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'source-over';
    ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
    ctx.drawImage(scratch, 0, 0);
  }
  ctx.filter = 'none';
  return canvasToPngBlob(out);
}

export async function outpaintMaskBlob(
  srcW: number,
  srcH: number,
  pad: { left: number; right: number; top: number; bottom: number },
): Promise<Blob> {
  const left = Math.round(pad.left * srcW);
  const right = Math.round(pad.right * srcW);
  const top = Math.round(pad.top * srcH);
  const bottom = Math.round(pad.bottom * srcH);
  const canvas = makeCanvas(srcW + left + right, srcH + top + bottom);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(left, top, srcW, srcH);
  return canvasToPngBlob(canvas);
}
