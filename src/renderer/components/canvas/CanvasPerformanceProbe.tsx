import { useEffect, useRef, useState } from 'react';

const HIDE_MINIMAP = 'reizo-canvas-perf-hide-minimap';
const HIDE_BACKGROUND = 'reizo-canvas-perf-hide-background';

/** Opt-in dev measurement. Readable DOM output keeps QA out of application internals. */
export default function CanvasPerformanceProbe() {
  const output = useRef<HTMLOutputElement>(null);
  const [hideMinimap, setHideMinimap] = useState(false);
  const [hideBackground, setHideBackground] = useState(false);
  useEffect(() => {
    const stage = output.current?.closest('[data-canvas-workspace]');
    if (!stage) return;
    let restore: (() => void) | undefined;
    const apply = () => {
      const canvas = stage.querySelector<HTMLElement>('.react-flow');
      if (!canvas) return false;
      const previousMinimap = canvas.classList.contains(HIDE_MINIMAP);
      const previousBackground = canvas.classList.contains(HIDE_BACKGROUND);
      canvas.classList.toggle(HIDE_MINIMAP, hideMinimap);
      canvas.classList.toggle(HIDE_BACKGROUND, hideBackground);
      restore = () => {
        canvas.classList.toggle(HIDE_MINIMAP, previousMinimap);
        canvas.classList.toggle(HIDE_BACKGROUND, previousBackground);
      };
      return true;
    };
    // The probe can mount before the lazy canvas. Stop observing once that root exists.
    const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
    if (!apply()) observer.observe(stage, { childList: true, subtree: true });
    return () => { observer.disconnect(); restore?.(); };
  }, [hideMinimap, hideBackground]);
  useEffect(() => {
    let frame = 0;
    let last = 0;
    let start = performance.now();
    let intervals: number[] = [];
    let previousMoving = false;
    let gesture: number[] = [];
    let previousGesture = '';
    const summarize = (samples: number[]) => {
      const sorted = samples.slice().sort((a, b) => a - b);
      const duration = samples.reduce((sum, interval) => sum + interval, 0);
      return { fps: duration ? samples.length * 1000 / duration : 0, p95: sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0 };
    };
    const sample = (time: number) => {
      if (document.hidden) { last = 0; start = time; intervals = []; previousMoving = false; gesture = []; }
      else {
        const moving = output.current?.closest('[data-canvas-workspace]')?.querySelector('[data-dragging]')?.getAttribute('data-dragging') === 'true';
        if (moving && previousMoving && last && gesture.length < 10000) gesture.push(time - last);
        if (!moving && previousMoving && gesture.length > 1) {
          const result = summarize(gesture);
          previousGesture = ` · last gesture ${result.fps.toFixed(0)} fps / p95 ${result.p95.toFixed(1)} ms`;
          gesture = [];
        }
        if (moving && !previousMoving) gesture = [];
        previousMoving = moving;
        if (last) intervals.push(time - last);
        last = time;
        if (time - start >= 1000) {
          const { fps, p95 } = summarize(intervals);
          const nodes = output.current?.closest('[data-canvas-workspace]')?.querySelectorAll('.react-flow__node').length ?? 0;
          const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
          if (output.current) output.current.textContent = `rAF ${fps.toFixed(0)} fps · p95 ${p95.toFixed(1)} ms · ${nodes} rendered${memory ? ` · ${(memory / 1048576).toFixed(0)} MB JS heap` : ''}${previousGesture}`;
          intervals = []; start = time;
        }
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div className="pointer-events-none absolute right-3 top-14 z-40 flex max-w-[calc(100%-24px)] flex-col items-end gap-1">
    <style>{`.${HIDE_MINIMAP} .react-flow__minimap { display: none !important; } .${HIDE_BACKGROUND} .react-flow__background { display: none !important; }`}</style>
    <div role="group" aria-label="画布性能 A/B" className="pointer-events-auto flex gap-1 rounded border border-line bg-paper-raised/95 p-1 text-[10px] text-ink-muted">
      <button type="button" aria-pressed={hideMinimap} onClick={() => setHideMinimap((hidden) => !hidden)} className="rounded px-2 py-1 outline-none hover:bg-paper-inset focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-paper-inset">隐藏缩略导航</button>
      <button type="button" aria-pressed={hideBackground} onClick={() => setHideBackground((hidden) => !hidden)} className="rounded px-2 py-1 outline-none hover:bg-paper-inset focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-paper-inset">隐藏点阵背景</button>
    </div>
    <output ref={output} aria-label="画布性能参考" className="rounded border border-line bg-paper-raised/95 px-2 py-1 text-[10px] tabular-nums text-ink-muted">采样中…</output>
  </div>;
}
