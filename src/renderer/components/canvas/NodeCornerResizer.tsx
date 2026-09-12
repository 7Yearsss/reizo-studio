import { useState, useRef, memo } from 'react';
import { NodeResizeControl, type ResizeParams } from '@xyflow/react';
import * as canvasStore from '../../state/canvasStore';
import { cn } from '../../lib/cn';

export type CornerPosition = 'top-right' | 'bottom-right' | 'bottom-left' | 'top-left';

export interface NodeCornerResizerProps {
  nodeId: string;
  sessionId: string;
  hovered: boolean;
  minWidth?: number;
  minHeight?: number;
  keepAspectRatio?: boolean;
  corners?: CornerPosition[];
}

interface CornerConfig {
  position: CornerPosition;
  cursor: string;
  path: string;
}

const ALL_CORNERS: CornerConfig[] = [
  {
    position: 'top-right',
    cursor: '!cursor-nesw-resize',
    path: 'M 3.2 6.8 A 10.3 10.3 0 0 1 11.3 14.8',
  },
  {
    position: 'bottom-right',
    cursor: '!cursor-nwse-resize',
    path: 'M 11.3 3.2 A 10.3 10.3 0 0 1 3.2 11.3',
  },
  {
    position: 'bottom-left',
    cursor: '!cursor-nesw-resize',
    path: 'M 14.8 11.3 A 10.3 10.3 0 0 1 6.8 3.2',
  },
  {
    position: 'top-left',
    cursor: '!cursor-nwse-resize',
    path: 'M 6.8 14.8 A 10.3 10.3 0 0 1 14.8 6.8',
  },
];

function NodeCornerResizer({
  nodeId,
  sessionId,
  hovered,
  minWidth = 200,
  minHeight = 140,
  keepAspectRatio = false,
  corners = ['top-right', 'bottom-right', 'bottom-left', 'top-left'],
}: NodeCornerResizerProps) {
  const [activeResizingCorner, setActiveResizingCorner] = useState<CornerPosition | null>(null);
  const resizeStart = useRef<{ w: number; h: number; x?: number; y?: number } | null>(null);

  const isResizing = activeResizingCorner !== null;
  const isVisible = hovered || isResizing;
  if (!isVisible) return null;

  const activeCorners = ALL_CORNERS.filter((c) => corners.includes(c.position));

  const handleResizeStart = (position: CornerPosition, _: unknown, p: ResizeParams) => {
    setActiveResizingCorner(position);
    resizeStart.current = { w: p.width, h: p.height, x: p.x, y: p.y };
  };

  const handleResizeEnd = (_: unknown, p: ResizeParams) => {
    setActiveResizingCorner(null);
    const from = resizeStart.current;
    resizeStart.current = null;
    if (
      from &&
      (from.w !== p.width ||
        from.h !== p.height ||
        (from.x !== undefined && from.x !== p.x) ||
        (from.y !== undefined && from.y !== p.y))
    ) {
      canvasStore.commitResize(sessionId, nodeId, from, {
        w: Math.round(p.width),
        h: Math.round(p.height),
        x: p.x !== undefined ? Math.round(p.x) : undefined,
        y: p.y !== undefined ? Math.round(p.y) : undefined,
      });
    }
  };

  return (
    <>
      {activeCorners.map(({ position, cursor, path }) => {
        const isCurrentCornerResizing = activeResizingCorner === position;
        return (
          <NodeResizeControl
            key={position}
            nodeId={nodeId}
            position={position}
            minWidth={minWidth}
            minHeight={minHeight}
            keepAspectRatio={keepAspectRatio}
            onResizeStart={(e, p) => handleResizeStart(position, e, p)}
            onResizeEnd={handleResizeEnd}
            className={cn(
              '!w-[22px] !h-[22px] !bg-transparent !border-0 !p-0 !rounded-none flex items-center justify-center group/handle z-30 select-none cursor-pointer',
              cursor,
            )}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              className={cn(
                'overflow-visible pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-all duration-200 ease-out',
                isCurrentCornerResizing
                  ? 'opacity-100 scale-100'
                  : 'opacity-0 scale-75 group-hover/handle:opacity-100 group-hover/handle:scale-100',
              )}
            >
              <path
                d={path}
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </NodeResizeControl>
        );
      })}
    </>
  );
}

export default memo(NodeCornerResizer);
