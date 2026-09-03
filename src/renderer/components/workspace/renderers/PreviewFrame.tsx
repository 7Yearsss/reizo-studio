import { useState } from 'react';
import { Monitor, Smartphone, Tablet, ZoomIn, ZoomOut } from 'lucide-react';

type Device = 'desktop' | 'tablet' | 'mobile';
const SIZES: Record<Device, { w: number | null; label: string; icon: React.ReactNode }> = {
  desktop: { w: null, label: '桌面', icon: <Monitor size={12} /> },
  tablet: { w: 820, label: '平板', icon: <Tablet size={12} /> },
  mobile: { w: 390, label: '手机', icon: <Smartphone size={12} /> },
};

/**
 * Chrome for HTML / SVG previews: a device-width segmented control + zoom.
 * The child is expected to be an `<iframe>` or inline SVG that fills its box.
 */
export default function PreviewFrame({ children }: { children: React.ReactNode }) {
  const [device, setDevice] = useState<Device>('desktop');
  const [zoom, setZoom] = useState(1);
  const width = SIZES[device].w;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        {(Object.keys(SIZES) as Device[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDevice(d)}
            className={[
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
              device === d ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset/60',
            ].join(' ')}
            title={SIZES[d].label}
          >
            {SIZES[d].icon}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset/60"
          >
            <ZoomOut size={12} />
          </button>
          <span className="w-9 text-center text-[10px] tabular-nums text-ink-muted">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100))}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset/60"
          >
            <ZoomIn size={12} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-paper-inset/30 p-2">
        <div
          className="mx-auto h-full origin-top bg-paper-raised shadow-sm"
          style={{
            width: width ?? '100%',
            maxWidth: '100%',
            transform: zoom === 1 ? undefined : `scale(${zoom})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
