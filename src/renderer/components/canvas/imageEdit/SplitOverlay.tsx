import { useState } from 'react';
import type { CanvasNode } from '../../../../shared/canvas';
import { splitGridRects } from '../../../../shared/canvasImageEdit';
import * as canvasStore from '../../../state/canvasStore';
import { splitImageBlobs } from './pixelOps';
import EditOverlayShell from './EditOverlayShell';

type GridType = '2x2' | '3x3' | '4x4';

const GRID_OPTIONS: Array<{ id: GridType; label: string }> = [
  { id: '2x2', label: '2×2 四宫格' },
  { id: '3x3', label: '3×3 九宫格' },
  { id: '4x4', label: '4×4 十六格' },
];

export default function SplitOverlay({
  sessionId,
  node,
  imageUrl,
  onClose,
}: {
  sessionId: string;
  node: CanvasNode;
  imageUrl: string;
  onClose: () => void;
}) {
  const [grid, setGrid] = useState<GridType>('2x2');
  const [busy, setBusy] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const rects = splitGridRects(grid);

  const confirm = async () => {
    setBusy(true);
    try {
      const tiles = await splitImageBlobs(imageUrl, grid);
      await canvasStore.deriveImageSplit(sessionId, node.id, grid, tiles);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditOverlayShell
      title="网格切图"
      confirmLabel={busy ? '切分中…' : `切分为 ${rects.length} 个节点`}
      onClose={onClose}
      onConfirm={() => void confirm()}
      confirming={busy}
      extraActions={
        <div className="flex items-center gap-1 pr-1">
          {GRID_OPTIONS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGrid(g.id)}
              className={
                grid === g.id
                  ? 'rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium text-white shadow-xs'
                  : 'rounded-full px-2.5 py-1 text-[11px] text-white/60 hover:text-white transition-colors'
              }
            >
              {g.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="relative max-h-[72vh] max-w-[72vw] overflow-hidden select-none rounded-lg shadow-2xl">
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="max-h-[72vh] max-w-[72vw] object-contain block"
        />

        {/* Interactive Grid Overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {rects.map((r, i) => {
            const isHovered = hoveredIdx === i;
            return (
              <div
                key={i}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                }}
                className={`pointer-events-auto absolute box-border border border-white/60 transition-colors ${
                  isHovered ? 'bg-accent/15 border-accent' : 'bg-transparent'
                }`}
              >
                {/* Tile Numbering Badge */}
                <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md border border-white/20 bg-black/65 px-2 py-0.5 backdrop-blur-sm shadow-md">
                  <span className="text-[11px] font-semibold text-white/95">#{i + 1}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </EditOverlayShell>
  );
}
