import { useEffect, useRef, memo } from 'react';

export interface ThinkingOrbProps {
  /** Size in pixels (default: 16) */
  size?: number;
  /** Whether the orb is actively animating */
  active?: boolean;
  /** CSS class */
  className?: string;
  /** Optional theme override or accent color */
  color?: string;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
  baseRadius: number;
}

/** Generate points evenly distributed across a Fibonacci sphere */
function generateSpherePoints(count: number, radius: number): Point3D[] {
  const points: Point3D[] = [];
  const phi = Math.PI * (Math.sqrt(5) - 1); // Golden ratio angle

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2; // y goes from 1 to -1
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = phi * i;

    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;

    points.push({
      x: x * radius,
      y: y * radius,
      z: z * radius,
      baseRadius: radius,
    });
  }
  return points;
}

const POINT_COUNT = 24;
const BASE_POINTS = generateSpherePoints(POINT_COUNT, 1);

/**
 * ThinkingOrb is an organic, multi-layered 3D wireframe orb rendered in pure 2D canvas.
 * It indicates active AI thinking / reasoning states with a premium, alive texture.
 */
export const ThinkingOrb = memo(function ThinkingOrb({
  size = 16,
  active = true,
  className,
  color,
}: ThinkingOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const sphereRadius = (size / 2) * 0.78;
    const center = (size / 2) * dpr;
    const scale = dpr;

    let isVisible = true;
    const observer = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
    });
    observer.observe(canvas);

    const prefersReducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    // Default accent or fallback
    const resolvedColor = color || '#3b82f6';

    const render = (timeMs: number) => {
      if (!ctx || !canvas) return;

      const t = prefersReducedMotion ? 1200 : timeMs * 0.0018;
      const angleY = t * 1.2;
      const angleX = Math.sin(t * 0.7) * 0.5 + 0.4;
      const pulse = 1 + Math.sin(t * 2.4) * 0.08;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Central ambient glow
      const glowGrad = ctx.createRadialGradient(
        center,
        center,
        0,
        center,
        center,
        sphereRadius * scale * 1.2,
      );
      glowGrad.addColorStop(0, 'rgba(59, 130, 246, 0.22)');
      glowGrad.addColorStop(0.6, 'rgba(59, 130, 246, 0.06)');
      glowGrad.addColorStop(1, 'rgba(59, 130, 246, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(center, center, sphereRadius * scale * 1.2, 0, Math.PI * 2);
      ctx.fill();

      // Transform 3D points
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);

      const projected = BASE_POINTS.map((pt) => {
        // Rotate around Y
        const x1 = pt.x * cosY - pt.z * sinY;
        const z1 = pt.z * cosY + pt.x * sinY;

        // Rotate around X
        const y2 = pt.y * cosX - z1 * sinX;
        const z2 = z1 * cosX + pt.y * sinX;

        const currentRadius = sphereRadius * pulse;
        const x2d = center + x1 * currentRadius * scale;
        const y2d = center + y2 * currentRadius * scale;
        const depthNorm = (z2 + 1) / 2; // 0 (far) to 1 (near)

        return { x: x2d, y: y2d, depth: depthNorm };
      });

      // Sort by depth so far points draw behind near points
      projected.sort((a, b) => a.depth - b.depth);

      // Draw subtle connecting arcs/lines between close neighbors
      ctx.lineWidth = 0.75 * scale;
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const dx = projected[i].x - projected[j].x;
          const dy = projected[i].y - projected[j].y;
          const distSq = dx * dx + dy * dy;
          const maxDist = (sphereRadius * scale * 0.95) ** 2;

          if (distSq < maxDist) {
            const avgDepth = (projected[i].depth + projected[j].depth) / 2;
            const alpha = Math.max(0.04, avgDepth * 0.28);
            ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(projected[i].x, projected[i].y);
            ctx.lineTo(projected[j].x, projected[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw node points
      for (const p of projected) {
        const radius = Math.max(0.6, (0.7 + p.depth * 1.2) * scale);
        const alpha = Math.max(0.18, 0.2 + p.depth * 0.8);
        ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (active && !prefersReducedMotion && isVisible && document.visibilityState === 'visible') {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    render(performance.now());

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && active && !prefersReducedMotion && isVisible) {
        if (!animFrameRef.current) {
          animFrameRef.current = requestAnimationFrame(render);
        }
      } else if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [size, active, color]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="AI 正在思考"
      className={className}
      style={{ width: `${size}px`, height: `${size}px`, display: 'inline-block', flexShrink: 0 }}
    />
  );
});

export default ThinkingOrb;
