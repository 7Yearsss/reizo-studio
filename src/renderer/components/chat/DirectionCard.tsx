import { useState } from 'react';
import { Check, ZoomIn } from 'lucide-react';
import type { DirectionCard as Direction } from '../../../shared/stream';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';
import { getCanvasNodeThumbnail } from '../canvas/canvasThumbnail';
import { getResolvedApiOrigin } from '../../api';
import Lightbox from '../canvas/Lightbox';

/** `skill-asset:<skillId>/<file>` → served asset URL; anything else is used verbatim. */
function resolveImageUrl(url: string): string | null {
  const m = url.match(/^skill-asset:([^/]+)\/(.+)$/);
  if (!m) return url;
  const origin = getResolvedApiOrigin();
  return origin ? `${origin}/api/skills/${encodeURIComponent(m[1])}/assets/${encodeURIComponent(m[2])}` : null;
}

export default function DirectionCardChoice({
  direction,
  selected,
  recommended,
  onPick,
  sessionId,
}: {
  direction: Direction;
  selected: boolean;
  recommended?: boolean;
  onPick: () => void;
  sessionId?: string;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const thumbnail = useCanvasStore((s) => {
    if (!sessionId || !direction.nodeId) return undefined;
    const node = (s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES).find(
      (n) => n.id === direction.nodeId,
    );
    return node ? getCanvasNodeThumbnail(node) : undefined;
  }) ?? (direction.imageUrl ? resolveImageUrl(direction.imageUrl) ?? undefined : undefined);

  return (
    <button
      type="button"
      onClick={onPick}
      className={[
        'group relative flex w-full flex-col gap-2.5 rounded-xl border p-3 text-left transition-all duration-200',
        selected
          ? 'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-xs'
          : 'border-line bg-paper hover:bg-paper-inset/60 hover:border-line-hover',
      ].join(' ')}
    >
      {thumbnail && (
        <div className="group/thumb relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-line/50 bg-paper-inset/40">
          <img src={thumbnail} alt={direction.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
          <button
            type="button"
            title="放大预览"
            onClick={(e) => {
              e.stopPropagation();
              setZoom(thumbnail);
            }}
            className="absolute right-1.5 top-1.5 cursor-zoom-in rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover/thumb:opacity-100"
          >
            <ZoomIn size={12} />
          </button>
        </div>
      )}

      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-xs font-semibold text-ink truncate">{direction.title}</span>
        {selected ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.2 text-[10px] font-medium text-white shadow-xs">
            <Check size={10} />
            已选
          </span>
        ) : recommended ? (
          <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.2 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            推荐
          </span>
        ) : null}
      </div>

      {/* Mood tag or font display */}
      {(direction.mood || direction.displayFont) && (
        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
          {direction.displayFont && (
            <span
              className="text-xs font-semibold text-ink/80"
              style={{ fontFamily: direction.displayFont }}
              title={`字体: ${direction.displayFont}`}
            >
              Aa
            </span>
          )}
          {direction.mood && (
            <span className="truncate">{direction.mood}</span>
          )}
        </div>
      )}

      {/* Palette color swatches */}
      {direction.palette && direction.palette.length > 0 && (
        <div className="mt-0.5 flex items-center gap-1">
          {direction.palette.map((color, idx) => (
            <span
              key={idx}
              className="h-3 w-3 rounded-full border border-black/10 shadow-2xs dark:border-white/10"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}

      {/* References */}
      {direction.references && direction.references.length > 0 && (
        <div className="text-[10px] text-ink-muted/80 truncate">
          参考：{direction.references.join(' · ')}
        </div>
      )}

      {zoom ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Lightbox src={zoom} onClose={() => setZoom(null)} />
        </div>
      ) : null}
    </button>
  );
}
