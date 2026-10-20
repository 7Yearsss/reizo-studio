import { useEffect, useState } from 'react';
import { AlertTriangle, Clapperboard, Monitor, Play, RotateCw, Smartphone, Tablet, X, ZoomIn, ZoomOut } from 'lucide-react';

type Device = 'desktop' | 'motion' | 'tablet' | 'mobile';

const SIZES: Record<Device, { w: number | null; label: string; icon: React.ReactNode }> = {
  desktop: { w: null, label: '桌面自适应', icon: <Monitor size={12} /> },
  motion: { w: 960, label: '16:9 动效/大屏', icon: <Clapperboard size={12} /> },
  tablet: { w: 820, label: '平板 (820px)', icon: <Tablet size={12} /> },
  mobile: { w: 390, label: '手机 (390px)', icon: <Smartphone size={12} /> },
};

/**
 * Chrome for HTML / SVG previews:
 * - Device viewport switcher with smooth CSS transitions
 * - Zoom in / Zoom out controls
 * - Interactive Run / Pause script execution toggle
 * - Safe error catcher that alerts on unhandled script exceptions in preview
 */
export default function PreviewFrame({
  children,
  run,
  onToggleRun,
  onReload,
}: {
  children: React.ReactNode;
  run?: boolean;
  onToggleRun?: () => void;
  onReload?: () => void;
}) {
  const [device, setDevice] = useState<Device>('desktop');
  const [zoom, setZoom] = useState(1);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const width = SIZES[device].w;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.data && typeof event.data === 'object' && event.data.type === 'reizo:preview-error') {
        const line = event.data.lineno ? ` (行 ${event.data.lineno})` : '';
        setRuntimeError(`${event.data.message}${line}`);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleReload = () => {
    setRuntimeError(null);
    onReload?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        {(Object.keys(SIZES) as Device[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDevice(d)}
            className={[
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors',
              device === d
                ? 'bg-paper-inset text-ink shadow-xs'
                : 'text-ink-muted hover:bg-paper-inset/60 hover:text-ink',
            ].join(' ')}
            title={SIZES[d].label}
          >
            {SIZES[d].icon}
          </button>
        ))}

        {onToggleRun && (
          <div className="ml-2 flex items-center gap-1 border-l border-line/60 pl-2">
            <button
              type="button"
              onClick={onToggleRun}
              className={[
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-all',
                run
                  ? 'bg-accent/15 text-accent shadow-xs'
                  : 'text-ink-muted hover:bg-paper-inset/60 hover:text-ink',
              ].join(' ')}
              title={run ? '暂停脚本执行（安全静态）' : '开启交互模式（运行 JS / Canvas / GSAP 动画）'}
            >
              <Play size={11} className={run ? 'fill-accent' : ''} />
              <span>{run ? '交互运行中' : '运行脚本'}</span>
            </button>
            {run && onReload && (
              <button
                type="button"
                onClick={handleReload}
                className="rounded p-1 text-ink-muted hover:bg-paper-inset/60 hover:text-ink transition-colors"
                title="重新载入页面并重启动画"
              >
                <RotateCw size={11} />
              </button>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset/60 hover:text-ink transition-colors"
            title="缩小"
          >
            <ZoomOut size={12} />
          </button>
          <span className="w-9 text-center text-[11px] tabular-nums text-ink-muted select-none">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100))}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset/60 hover:text-ink transition-colors"
            title="放大"
          >
            <ZoomIn size={12} />
          </button>
        </div>
      </div>

      {runtimeError && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle size={13} className="shrink-0 text-amber-500" />
            <span className="truncate">页面运行异常：{runtimeError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRuntimeError(null)}
            className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 text-ink-muted hover:text-ink"
            title="忽略"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-paper-inset/30 p-2">
        <div
          className="mx-auto h-full origin-top bg-paper-raised shadow-sm transition-[width,transform] duration-250 ease-out"
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
