import { LayoutGrid } from 'lucide-react';

/**
 * Lightweight placeholder shown while the canvas chunk loads. Pure CSS — no
 * layout work, so the drawer can slide in without waiting on anything.
 */
export default function CanvasSkeleton({ label = '正在就绪画布…' }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-sidebar"
      style={{
        backgroundImage:
          'radial-gradient(circle, var(--canvas-dot, rgba(255, 255, 255, 0.22)) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="flex items-center gap-2 rounded-full border border-line/60 bg-paper-raised/80 px-3 py-1.5 text-xs text-ink-muted shadow-sm backdrop-blur-sm">
        <LayoutGrid size={13} className="animate-pulse opacity-70" />
        <span>{label}</span>
      </div>
    </div>
  );
}
