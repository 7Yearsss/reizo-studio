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
  const [isResizing, setIsResizing] = useState(false);
  const resizeStart = useRef<{ w: number; h: number } | null>(null);

  const isVisible = hovered || isResizing;
  if (!isVisible) return null;

  const activeCorners = ALL_CORNERS.filter((c) => corners.includes(c.position));

  const handleResizeStart = (_: unknown, p: ResizeParams) => {
    setIsResizing(true);
    resizeStart.current = { w: p.width, h: p.height };
  };

  const handleResizeEnd = (_: unknown, p: ResizeParams) => {
    setIsResizing(false);
    const from = resizeStart.current;
    resizeStart.current = null;
    if (from && (from.w !== p.width || from.h !== p.height)) {
      canvasStore.commitResize(sessionId, nodeId, from, {
        w: Math.round(p.width),
        h: Math.round(p.height),
      });
    }
  };

  return (
    <>
      {activeCorners.map(({ position, cursor, path }) => (
        <NodeResizeControl
          key={position}
          nodeId={nodeId}
          position={position}
          minWidth={minWidth}
          minHeight={minHeight}
          keepAspectRatio={keepAspectRatio}
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
          className={cn(
            '!w-[18px] !h-[18px] !bg-transparent !border-0 !p-0 !rounded-none flex items-center justify-center group/handle transition-transform hover:scale-105 active:scale-100 z-30 select-none',
            cursor,
          )}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            className="overflow-visible pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]"
          >
            <path
              d={path}
              stroke="white"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="opacity-80 transition-opacity group-hover/handle:opacity-100"
            />
          </svg>
        </NodeResizeControl>
      ))}
    </>
  );
}

export default memo(NodeCornerResizer);
