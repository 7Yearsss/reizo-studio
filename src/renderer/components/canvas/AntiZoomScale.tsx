import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '@xyflow/react';

/**
 * Inverse-zooms floating node chrome so it stays a constant screen size at any
 * canvas zoom (the TapNow-style header pattern). Subscribing to the viewport
 * transform here — inside the floating element — means the parent node body
 * does NOT re-render on every pan/zoom frame; only this small wrapper does.
 */
export function AntiZoomScale({
  children,
  className,
  translateY = -28,
}: {
  children: ReactNode;
  className?: string;
  translateY?: number;
}) {
  const zoom = useStore((s) => s.transform[2]) || 1;
  const scale = Math.min(8, Math.max(1, 1 / zoom));
  const style: CSSProperties = {
    transform: `translateX(-50%) scale(${scale}) translateY(${translateY}px)`,
    transformOrigin: 'bottom center',
  };
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
