import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useReactFlow,
  useStore,
  ViewportPortal,
  experimental_useOnNodesChangeMiddleware,
  type NodeChange,
  type Node,
} from '@xyflow/react';
import { calculateSmartGuides, type GuideLine, type NodeRect } from './smartGuides';

export interface AlignmentGuidesProps {
  sessionId: string;
  enabled?: boolean;
}

interface DraggingPositionChange {
  id: string;
  type: 'position';
  position: { x: number; y: number };
  dragging: boolean;
}

function isDraggingPositionChange(
  c: NodeChange<Node>,
): c is NodeChange<Node> & DraggingPositionChange {
  return (
    c.type === 'position' &&
    'id' in c &&
    typeof (c as { id?: unknown }).id === 'string' &&
    !!(c as { position?: unknown }).position &&
    (c as { dragging?: unknown }).dragging === true
  );
}

function isPositionStopChange(c: NodeChange<Node>): boolean {
  return c.type === 'position' && (c as { dragging?: unknown }).dragging === false;
}

export function AlignmentGuides({ enabled = true }: AlignmentGuidesProps) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]) || 1;

  const [guides, setGuides] = useState<{
    horizontal: GuideLine | null;
    vertical: GuideLine | null;
  }>({ horizontal: null, vertical: null });

  const activeGuidesRef = useRef<{
    horizontal: GuideLine | null;
    vertical: GuideLine | null;
  }>({ horizontal: null, vertical: null });

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const clearGuides = useCallback(() => {
    if (activeGuidesRef.current.horizontal || activeGuidesRef.current.vertical) {
      activeGuidesRef.current = { horizontal: null, vertical: null };
      setGuides({ horizontal: null, vertical: null });
    }
  }, []);

  // Global mouse release safety cleanup
  useEffect(() => {
    window.addEventListener('pointerup', clearGuides);
    window.addEventListener('pointercancel', clearGuides);
    return () => {
      window.removeEventListener('pointerup', clearGuides);
      window.removeEventListener('pointercancel', clearGuides);
    };
  }, [clearGuides]);

  // If enabled becomes false, clear immediately
  useEffect(() => {
    if (!enabled) clearGuides();
  }, [enabled, clearGuides]);

  // React Flow middleware intercepting node drag changes
  const middleware = useCallback(
    (changes: NodeChange<Node>[]) => {
      if (!enabledRef.current) {
        clearGuides();
        return changes;
      }

      // Collect position changes that are actively dragging
      const dragChanges = changes.filter(isDraggingPositionChange);

      if (dragChanges.length === 0) {
        // If a change with dragging === false occurred, drag just stopped
        if (changes.some(isPositionStopChange)) {
          clearGuides();
        }
        return changes;
      }

      const allNodes = rf.getNodes();
      const draggedIds = new Set(dragChanges.map((c) => c.id));

      // Build target rectangles from nodes that are NOT being dragged
      const others: NodeRect[] = [];
      for (const n of allNodes) {
        if (draggedIds.has(n.id)) continue;
        if (n.type === 'section') continue;
        const w = n.measured?.width ?? n.width ?? (n.data?.node as any)?.w ?? 320;
        const h = n.measured?.height ?? n.height ?? (n.data?.node as any)?.h ?? 200;
        others.push({
          id: n.id,
          x: n.position.x,
          y: n.position.y,
          width: w,
          height: h,
          type: n.type,
        });
      }

      if (others.length === 0) {
        clearGuides();
        return changes;
      }

      // Primary reference dragged node
      const primaryChange = dragChanges[0];
      const primaryNode = rf.getNode(primaryChange.id);
      if (!primaryNode || !primaryChange.position) return changes;

      const primaryW =
        primaryNode.measured?.width ??
        primaryNode.width ??
        (primaryNode.data?.node as any)?.w ??
        320;
      const primaryH =
        primaryNode.measured?.height ??
        primaryNode.height ??
        (primaryNode.data?.node as any)?.h ??
        200;

      const draggedRect: NodeRect = {
        id: primaryChange.id,
        x: primaryChange.position.x,
        y: primaryChange.position.y,
        width: primaryW,
        height: primaryH,
        type: primaryNode.type,
      };

      const result = calculateSmartGuides(draggedRect, others, zoom);

      const deltaX = result.snappedPosition.x - primaryChange.position.x;
      const deltaY = result.snappedPosition.y - primaryChange.position.y;

      // Apply delta to all dragged nodes (supports multi-selection dragging)
      if (deltaX !== 0 || deltaY !== 0) {
        for (const c of dragChanges) {
          if (c.position) {
            c.position = {
              x: c.position.x + deltaX,
              y: c.position.y + deltaY,
            };
          }
        }
      }

      // Update guides state if changed
      const prev = activeGuidesRef.current;
      const nextH = result.horizontal;
      const nextV = result.vertical;
      const hasChanged =
        prev.horizontal?.pos !== nextH?.pos ||
        prev.vertical?.pos !== nextV?.pos ||
        prev.horizontal?.start !== nextH?.start ||
        prev.vertical?.start !== nextV?.start;

      if (hasChanged) {
        activeGuidesRef.current = { horizontal: nextH, vertical: nextV };
        setGuides({ horizontal: nextH, vertical: nextV });
      }

      return changes;
    },
    [rf, zoom, clearGuides],
  );

  experimental_useOnNodesChangeMiddleware(middleware);

  if (!enabled || (!guides.horizontal && !guides.vertical)) {
    return null;
  }

  const strokeWidth = 1 / zoom;

  return (
    <ViewportPortal>
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        style={{
          width: '100%',
          height: '100%',
          zIndex: 1000,
        }}
      >
        {/* Horizontal Guide Line (y = const) */}
        {guides.horizontal && (
          <g>
            <line
              x1={guides.horizontal.start}
              y1={guides.horizontal.pos}
              x2={guides.horizontal.end}
              y2={guides.horizontal.pos}
              stroke={
                guides.horizontal.alignment === 'center'
                  ? 'rgba(249, 115, 22, 0.42)'
                  : 'rgba(249, 115, 22, 0.32)'
              }
              strokeWidth={strokeWidth}
              strokeDasharray={`${4 / zoom} ${4 / zoom}`}
            />
            {guides.horizontal.centerPoints?.map((pt, i) => (
              <circle
                key={`h-pt-${i}`}
                cx={pt.x}
                cy={pt.y}
                r={2.5 / zoom}
                fill="rgba(249, 115, 22, 0.55)"
                stroke="#161618"
                strokeWidth={strokeWidth}
              />
            ))}
          </g>
        )}

        {/* Vertical Guide Line (x = const) */}
        {guides.vertical && (
          <g>
            <line
              x1={guides.vertical.pos}
              y1={guides.vertical.start}
              x2={guides.vertical.pos}
              y2={guides.vertical.end}
              stroke={
                guides.vertical.alignment === 'center'
                  ? 'rgba(249, 115, 22, 0.42)'
                  : 'rgba(249, 115, 22, 0.32)'
              }
              strokeWidth={strokeWidth}
              strokeDasharray={`${4 / zoom} ${4 / zoom}`}
            />
            {guides.vertical.centerPoints?.map((pt, i) => (
              <circle
                key={`v-pt-${i}`}
                cx={pt.x}
                cy={pt.y}
                r={2.5 / zoom}
                fill="rgba(249, 115, 22, 0.55)"
                stroke="#161618"
                strokeWidth={strokeWidth}
              />
            ))}
          </g>
        )}
      </svg>
    </ViewportPortal>
  );
}
