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
    path: 'M 5 10.5 A 16 16 0 0 1 17.5 23',
  },
  {
    position: 'bottom-right',
    cursor: '!cursor-nwse-resize',
    path: 'M 17.5 5 A 16 16 0 0 1 5 17.5',
  },
  {
    position: 'bottom-left',
    cursor: '!cursor-nesw-resize',
    path: 'M 23 17.5 A 16 16 0 0 1 10.5 5',
  },
  {
    position: 'top-left',
    cursor: '!cursor-nwse-resize',
    path: 'M 10.5 23 A 16 16 0 0 1 23 10.5',
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
            '!w-7 !h-7 !bg-transparent !border-0 !p-0 !rounded-none flex items-center justify-center group/handle transition-transform hover:scale-110 active:scale-105 z-30 select-none',
            cursor,
          )}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            className="overflow-visible pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
          >
            <path
              d={path}
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="opacity-90 transition-opacity group-hover/handle:opacity-100 group-hover/handle:stroke-[2.75]"
            />
          </svg>
        </NodeResizeControl>
      ))}
    </>
  );
}

export default memo(NodeCornerResizer);
