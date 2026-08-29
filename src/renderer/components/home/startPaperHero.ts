// eslint-disable-next-line import/no-unresolved -- vgpu publishes only `exports`, no `main`
import { clock, effect, frame, frameLoop, init, surface } from 'vgpu';
import type { Effect, FrameLoopHandle, Gpu, Surface } from 'vgpu';
import { parseCssColor } from '../../lib/parseCssColor';
import paperHeroShader from './paperHero.wgsl';

export type PaperHeroHandle = {
  setActive(active: boolean): void;
  dispose(): void;
};

type Theme = {
  paper: [number, number, number];
  ink: [number, number, number];
  accent: [number, number, number];
  dark: number;
};

const POINTER_FALLBACK: [number, number] = [0.5, 0.5];
const POINTER_FOLLOW = 6.4;

function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement);
  return {
    paper: parseCssColor(style.getPropertyValue('--paper')),
    ink: parseCssColor(style.getPropertyValue('--ink')),
    accent: parseCssColor(style.getPropertyValue('--accent')),
    dark: document.documentElement.classList.contains('dark') ? 1 : 0,
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function pointerUv(canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
  const box = canvas.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return POINTER_FALLBACK;
  return [
    (clientX - box.left) / box.width,
    (clientY - box.top) / box.height,
  ];
}

export function startPaperHero(canvas: HTMLCanvasElement): PaperHeroHandle {
  let disposed = false;
  let active = true;
  let gpu: Gpu | undefined;
  let canvasSurface: Surface | undefined;
  let wash: Effect | undefined;
  let loop: FrameLoopHandle | undefined;
  let time: ReturnType<typeof clock> | undefined;

  let pointerTarget: [number, number] = [...POINTER_FALLBACK];
  const pointerCurrent: [number, number] = [...POINTER_FALLBACK];
  let influenceTarget = 0;
  let influenceCurrent = 0;

  const applyUniforms = (dt: number) => {
    if (!wash || !canvasSurface || !time) return;
    const theme = readTheme();
    const k = 1 - Math.exp(-dt * POINTER_FOLLOW);
    pointerCurrent[0] += (pointerTarget[0] - pointerCurrent[0]) * k;
    pointerCurrent[1] += (pointerTarget[1] - pointerCurrent[1]) * k;
    influenceCurrent += (influenceTarget - influenceCurrent) * k;
    const [width, height] = canvasSurface.size;
    wash.set({
      params: {
        time: time.time,
        motion: prefersReducedMotion() ? 0 : 1,
        dark: theme.dark,
        pointer: [pointerCurrent[0], pointerCurrent[1], influenceCurrent, 0],
        resolution: [width, height],
        paper: [...theme.paper, 1],
        ink: [...theme.ink, 1],
        accent: [...theme.accent, 1],
      },
    });
    canvasSurface.clearColor = [...theme.paper, 1];
  };

  const drawOnce = () => {
    if (!gpu || !canvasSurface || !wash || gpu.disposed) return;
    const target = canvasSurface;
    const fx = wash;
    applyUniforms(1 / 30);
    frame(gpu, (current) => current.pass(target, fx));
    canvas.dataset.ready = 'true';
  };

  const stopLoop = () => {
    loop?.stop();
    loop = undefined;
  };

  const startLoop = () => {
    if (!gpu || !canvasSurface || !wash || gpu.disposed || loop) return;
    if (!active || document.hidden || prefersReducedMotion()) {
      drawOnce();
      return;
    }
    const target = canvasSurface;
    const fx = wash;
    loop = frameLoop(
      gpu,
      (current) => {
        applyUniforms(time?.deltaTime || 1 / 30);
        current.pass(target, fx);
        if (!canvas.dataset.ready) canvas.dataset.ready = 'true';
      },
      { fps: 24 },
    );
  };

  const syncPlayback = () => {
    if (disposed || !gpu) return;
    stopLoop();
    startLoop();
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerTarget = pointerUv(canvas, event.clientX, event.clientY);
    influenceTarget = 1;
  };

  const onPointerLeave = () => {
    influenceTarget = 0;
  };

  const host = canvas.parentElement;
  host?.addEventListener('pointermove', onPointerMove);
  host?.addEventListener('pointerleave', onPointerLeave);
  document.addEventListener('visibilitychange', syncPlayback);
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', syncPlayback);
  const themeObserver = new MutationObserver(() => {
    if (!loop) drawOnce();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  void (async () => {
    if (!('gpu' in navigator)) {
      console.warn('[paper-hero] WebGPU not available; keeping the static title.');
      return;
    }
    try {
      gpu = await init();
    } catch (err) {
      console.warn('[paper-hero] WebGPU init failed; keeping the static title.', err);
      return;
    }
    if (disposed) {
      gpu.dispose();
      return;
    }
    gpu.onError((err) => {
      console.warn('[paper-hero]', err);
    });
    const theme = readTheme();
    canvasSurface = surface(gpu, canvas, {
      dpr: [1, 2],
      clearColor: [...theme.paper, 1],
    });
    wash = effect(gpu, paperHeroShader, {
      label: 'paper-hero',
      set: {
        params: {
          time: 0,
          motion: prefersReducedMotion() ? 0 : 1,
          dark: theme.dark,
          pointer: [0.5, 0.5, 0, 0],
          resolution: canvasSurface.size,
          paper: [...theme.paper, 1],
          ink: [...theme.ink, 1],
          accent: [...theme.accent, 1],
        },
      },
    });
    time = clock(gpu);
    startLoop();
  })();

  return {
    setActive(next) {
      active = next;
      syncPlayback();
    },
    dispose() {
      disposed = true;
      stopLoop();
      host?.removeEventListener('pointermove', onPointerMove);
      host?.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', syncPlayback);
      motionQuery.removeEventListener('change', syncPlayback);
      themeObserver.disconnect();
      gpu?.dispose();
      gpu = undefined;
    },
  };
}
