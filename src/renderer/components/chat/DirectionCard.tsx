import { useState } from 'react';
import { ZoomIn } from 'lucide-react';
import type { DirectionCard as Direction } from '../../../shared/stream';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';
import { getCanvasNodeThumbnail } from '../canvas/canvasThumbnail';
import Lightbox from '../canvas/Lightbox';

export default function DirectionCardChoice({
  direction,
  selected,
  onPick,
  sessionId,
}: {
  direction: Direction;
  selected: boolean;
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
  });

  return (
    <button
      type="button"
      onClick={onPick}
      className={[
        'flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors',
        selected ? 'border-accent bg-accent/5' : 'border-line bg-paper hover:bg-paper-inset/60',
      ].join(' ')}
    >
      {thumbnail && (
        <div
          className="group/thumb relative aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-md border border-line/50"
          onClick={(e) => {
            e.stopPropagation();
            setZoom(thumbnail);
          }}
        >
          <img src={thumbnail} alt={direction.title} className="h-full w-full object-cover" />
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100">
            <ZoomIn size={12} />
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{direction.title}</span>
        {selected && <span className="text-[10px] text-accent">已选</span>}
      </div>

      {direction.palette && direction.palette.length > 0 && (
        <div className="flex gap-1">
          {direction.palette.slice(0, 6).map((hex, i) => (
            <span
              key={`${hex}-${i}`}
              className="h-5 w-5 rounded border border-line/50"
              style={{ background: hex }}
              title={hex}
            />
          ))}
        </div>
      )}

      <div className="flex items-baseline gap-2">
        <span
          className="text-lg leading-none"
          style={{ fontFamily: direction.displayFont || 'Georgia, serif' }}
        >
          Aa
        </span>
        <span
          className="text-[11px] text-ink-muted"
          style={{ fontFamily: direction.bodyFont || 'system-ui, sans-serif' }}
        >
          正文样例 Body sample
        </span>
      </div>

      {direction.mood && <p className="text-[11px] leading-4 text-ink-muted">{direction.mood}</p>}
      {direction.references && direction.references.length > 0 && (
        <p className="text-[10px] text-ink-muted/80">参考：{direction.references.join(' · ')}</p>
      )}
      {zoom ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Lightbox src={zoom} onClose={() => setZoom(null)} />
        </div>
      ) : null}
    </button>
  );
}
