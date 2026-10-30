import { useEffect, useRef } from 'react';
import { cellAlpha, mosaicGrid, sampleCellColors, seededRandom, type Rgb } from '../../../../shared/pixelMosaic';

const NEUTRAL: Rgb = [120, 120, 128];

/** Read `src` into a grid of average colours; null when the image cannot be read (load error or a tainted canvas). */
async function sampleImage(src: string, cols: number, rows: number): Promise<Rgb[] | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = cols * 4;
    c.height = rows * 4;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return sampleCellColors(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { cols, rows });
  } catch {
    return null;
  }
}

/**
 * Loading surface that wears the picture's own colours: a grid of cells that breathe out of phase.
 * With no readable source image the cells stay neutral. Reduced motion draws one still frame.
 */
export default function PixelMosaicField({ src, reduce = false, className }: { src?: string; reduce?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0;
    let stopped = false;
    let colors: Rgb[] | null = null;
    let grid = { cols: 0, rows: 0 };
    let phases: number[] = [];
    let speeds: number[] = [];

    const layout = (): void => {
      const w = canvas.clientWidth || 160;
      const h = canvas.clientHeight || 160;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      grid = mosaicGrid(w, h);
      const rnd = seededRandom(grid.cols * 131 + grid.rows);
      phases = Array.from({ length: grid.cols * grid.rows }, () => rnd() * Math.PI * 2);
      speeds = Array.from({ length: grid.cols * grid.rows }, () => 1 + rnd() * 2.2);
      colors = null;
      if (src) void sampleImage(src, grid.cols, grid.rows).then((c) => { if (!stopped) { colors = c; if (reduce) draw(0); } });
    };

    const draw = (seconds: number): void => {
      const cw = canvas.width / grid.cols;
      const ch = canvas.height / grid.rows;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const i = r * grid.cols + c;
          const [R, G, B] = colors?.[i] ?? NEUTRAL;
          ctx.fillStyle = `rgba(${R},${G},${B},${reduce ? 0.8 : cellAlpha(phases[i], speeds[i], seconds)})`;
          ctx.fillRect(Math.floor(c * cw) + 1, Math.floor(r * ch) + 1, Math.ceil(cw) - 1, Math.ceil(ch) - 1);
        }
      }
    };

    const loop = (t: number): void => {
      draw(t / 1000);
      if (!stopped) raf = requestAnimationFrame(loop);
    };

    layout();
    if (reduce) draw(0); else raf = requestAnimationFrame(loop);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { layout(); if (reduce) draw(0); });
    ro?.observe(canvas);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [src, reduce]);

  return <canvas ref={ref} aria-hidden className={className ?? 'absolute inset-0 h-full w-full'} />;
}
