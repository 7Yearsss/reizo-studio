import { useEffect, useRef } from 'react';
import { startPaperHero, type PaperHeroHandle } from './startPaperHero';

export default function HomeHero({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<PaperHeroHandle | null>(null);

  // GPU context is created once per HomePage mount; tab visibility
  // only pauses the loop via setActive.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = startPaperHero(canvas);
    handleRef.current = handle;
    handle.setActive(active);
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setActive(active);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className="home-hero-canvas pointer-events-none absolute -inset-x-16 -inset-y-10"
      aria-hidden="true"
    />
  );
}
