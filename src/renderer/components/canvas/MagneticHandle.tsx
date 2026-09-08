import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { Handle, Position, type HandleType, useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { colorForKind, type EdgeKind } from './edges/edgeStyles';

export const OPEN_HANDLE_MENU_EVENT = 'reizo:open-handle-menu';

export interface HandleMenuEventDetail {
  nodeId: string;
  handleId: string | null;
  handleType: 'source' | 'target';
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
}

export interface MagneticHandleProps {
  type: HandleType;
  id?: string;
  position: Position;
  nodeId: string;
  kind?: EdgeKind;
  label?: string;
  top?: string;
  disabled?: boolean;
  /**
   * Whether the parent node is currently hovered or selected.
   * When false the plus button is hidden (scale 0, translated back into the
   * node edge) so the canvas stays clean. When true it springs out.
   * Defaults to true for backwards-compat.
   */
  nodeHovered?: boolean;
}

/**
 * TapNow-style magnetic handle:
 * - Separates the invisible/tiny React Flow Handle (~3px) from the visible springy plus button (~14px).
 * - Outer hit area (~64px) detects cursor proximity and pulls the plus button towards the pointer
 *   with an elastic cubic-bezier transition (~250ms).
 * - Leaves with a smooth rebound (~400ms).
 * - Clicking the plus button dispatches `reizo:open-handle-menu` to open downstream creation or upstream context menu.
 * - Dragging starts native React Flow wire connection.
 */
function MagneticHandle({
  type,
  id,
  position,
  nodeId,
  kind = 'prompt',
  label,
  top = '50%',
  disabled = false,
  nodeHovered = true,
}: MagneticHandleProps) {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const hitRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const hasDraggedRef = useRef(false);
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const isLeft = position === Position.Left;
  const isRight = position === Position.Right;
  const activeColor = colorForKind(kind);

  // Read current canvas zoom level from React Flow store
  const zoom = useStore((s) => s.transform[2]) || 1;
  // Inverse scale: maintain comfortable physical button size on screen when zoomed out
  // Clamped between 1x and 5x (supports bird's-eye view down to ~20% zoom)
  const scale = Math.min(5, Math.max(1, 1 / zoom));

  // Read the node's dragging flag straight from the RF store — same source RF uses
  // internally, so it flips to true the instant the drag starts with zero lag.
  // This prevents the button from briefly popping out at the start of a drag.
  const isDragging = useStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId);
    return node?.dragging ?? false;
  });

  // Check if any edge is currently connected to this handle
  const isConnected = useStore(
    useCallback(
      (s) =>
        s.edges.some((e) => {
          if (type === 'source') {
            if (e.source !== nodeId) return false;
            return !e.sourceHandle || !id || e.sourceHandle === id;
          } else {
            if (e.target !== nodeId) return false;
            return !e.targetHandle || !id || e.targetHandle === id;
          }
        }),
      [type, nodeId, id],
    ),
  );

  // The button is only visible when the parent node is hovered/selected AND not being dragged.
  const visible = nodeHovered && !isDragging;

  // Immediately notify React Flow to measure this handle geometry on mount and on connection changes
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, updateNodeInternals, isConnected, visible]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !hitRef.current) return;

      if (pointerStartRef.current) {
        const dist = Math.hypot(
          e.clientX - pointerStartRef.current.x,
          e.clientY - pointerStartRef.current.y,
        );
        if (dist > 3) {
          hasDraggedRef.current = true;
        }
      }

      const rect = hitRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Elastic magnetic pull toward cursor, normalized by inverse scale for consistent screen-space feel
      const rawDx = (e.clientX - centerX) * 0.45;
      const rawDy = (e.clientY - centerY) * 0.45;
      const dx = Math.max(-14, Math.min(14, rawDx)) / scale;
      const dy = Math.max(-14, Math.min(14, rawDy)) / scale;

      setOffset({ x: dx, y: dy });
      setIsHovered(true);
    },
    [disabled, scale],
  );

  const handlePointerLeave = useCallback(() => {
    setOffset({ x: 0, y: 0 });
    setIsHovered(false);
  }, []);

  const handleButtonPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      pointerStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
      hasDraggedRef.current = false;

      // Forward native pointerdown & mousedown to React Flow Handle element to start connection dragging
      if (handleRef.current) {
        try {
          const pointerEvent = new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
            buttons: e.buttons || 1,
            button: e.button || 0,
            pointerId: e.pointerId || 1,
            pointerType: e.pointerType || 'mouse',
            view: window,
          });
          handleRef.current.dispatchEvent(pointerEvent);
        } catch {
          /* ignore */
        }
        const mouseEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: e.clientX,
          clientY: e.clientY,
          buttons: e.buttons || 1,
          button: e.button || 0,
          view: window,
        });
        handleRef.current.dispatchEvent(mouseEvent);
      }
    },
    [disabled],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (disabled) return;

      if (hasDraggedRef.current) {
        // Handled as a drag connection, do not open menu
        hasDraggedRef.current = false;
        pointerStartRef.current = null;
        return;
      }
      if (pointerStartRef.current && Date.now() - pointerStartRef.current.time > 300) {
        hasDraggedRef.current = false;
        pointerStartRef.current = null;
        return;
      }
      pointerStartRef.current = null;
      hasDraggedRef.current = false;

      const screenX = e.clientX;
      const screenY = e.clientY;
      const flowPos = rf.screenToFlowPosition({ x: screenX, y: screenY });

      const detail: HandleMenuEventDetail = {
        nodeId,
        handleId: id ?? null,
        handleType: type,
        screenX,
        screenY,
        flowX: Math.round(flowPos.x),
        flowY: Math.round(flowPos.y),
      };

      window.dispatchEvent(new CustomEvent(OPEN_HANDLE_MENU_EVENT, { detail }));
    },
    [disabled, id, nodeId, rf, type],
  );

  const tooltipText = label
    ? label
    : isRight
      ? '继续生成 / 引用该节点'
      : '添加上下文输入';

  // Distance from node border to button center when popped out (in handle local space).
  // The outer container is already scaled by `scale`, so popDistance here must NOT multiply by `scale` again!
  const baseRadius = 10;
  const gap = 6;
  const popDistance = baseRadius + gap;

  return (
    <>
      {/* 1. Precision Border Socket / React Flow Handle */}
      <Handle
        ref={handleRef}
        type={type}
        id={id}
        position={position}
        isConnectable={!disabled}
        data-magnetic-handle="true"
        data-node-id={nodeId}
        data-handle-type={type}
        data-handle-id={id ?? ''}
        style={{
          top,
          borderColor: isConnected || isHovered ? activeColor : 'var(--line-strong, #52525b)',
          backgroundColor: isConnected ? activeColor : isHovered ? activeColor : 'var(--paper-raised, #18181b)',
          boxShadow: isConnected
            ? `0 0 8px ${activeColor}cc, 0 0 2px 1px ${activeColor}55`
            : isHovered
              ? `0 0 5px ${activeColor}77`
              : undefined,
          opacity: isConnected ? 1 : visible ? 0.75 : 0,
          pointerEvents: disabled ? 'none' : 'auto',
          zIndex: 20,
        }}
        className={cn(
          '!cursor-crosshair transition-all duration-150',
          isConnected
            ? '!h-2.5 !w-2.5 !border-[1.5px] !border-black/60 shadow-xs'
            : visible
              ? '!h-2 !w-2 !border border-black/40'
              : '!h-1 !w-1 !opacity-0',
        )}
      />

      {/* 3. Floating Action Pop-out (+ button for branching / dragging new connection) */}
      <div
        data-magnetic-handle="true"
        data-node-id={nodeId}
        data-handle-type={type}
        data-handle-id={id ?? ''}
        style={{
          top,
          left: isLeft ? 0 : '100%',
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
          pointerEvents: 'none',
        }}
        className="nodrag nopan absolute z-30 flex items-center justify-center select-none magnetic-handle-wrapper"
      >
        {/* Animated pop-out container: launches from the border socket outwards */}
        <div
          style={{
            opacity: visible ? 1 : 0,
            transform: visible
              ? `translate3d(${isLeft ? -popDistance + offset.x : popDistance + offset.x}px, ${offset.y}px, 0) scale(1)`
              : `translate3d(0px, 0, 0) scale(0.3)`,
            transition: visible
              ? isHovered
                ? 'transform 240ms cubic-bezier(0.34, 1.9, 0.64, 1), opacity 160ms ease'
                : 'transform 280ms cubic-bezier(0.34, 1.7, 0.64, 1), opacity 180ms ease'
              : 'transform 180ms cubic-bezier(0.55, 0, 1, 0.45), opacity 140ms ease',
            transformOrigin: 'center center',
            pointerEvents: visible && !disabled ? 'auto' : 'none',
          }}
        >
          {/* Magnetic Hit Box */}
          <div
            ref={hitRef}
            data-magnetic-handle="true"
            data-node-id={nodeId}
            data-handle-type={type}
            data-handle-id={id ?? ''}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            className={cn(
              'relative flex h-10 w-10 items-center justify-center cursor-pointer',
              disabled && 'opacity-40',
            )}
          >
            <button
              type="button"
              data-magnetic-handle="true"
              data-node-id={nodeId}
              data-handle-type={type}
              data-handle-id={id ?? ''}
              onPointerDown={handleButtonPointerDown}
              onClick={handleClick}
              title={tooltipText}
              style={{
                borderColor: isHovered ? activeColor : 'var(--line-strong, #52525b)',
                boxShadow: isHovered ? `0 0 10px ${activeColor}55` : '0 2px 8px rgba(0,0,0,0.4)',
                transition: 'background-color 150ms, border-color 150ms, box-shadow 150ms',
              }}
              className={cn(
                'group relative flex h-5 w-5 items-center justify-center rounded-full border bg-paper-raised text-ink active:scale-90 shadow-xs',
                isHovered ? 'scale-125 bg-paper' : 'hover:scale-110',
              )}
            >
              <Plus
                size={11}
                style={{ color: isHovered ? activeColor : undefined }}
                className="shrink-0 transition-colors group-hover:scale-110 stroke-[2.5]"
              />

              {/* Micro label capsule on hover */}
              {isHovered && label ? (
                <span
                  className={cn(
                    'pointer-events-none absolute z-40 whitespace-nowrap rounded-md border border-line bg-paper-raised px-1.5 py-0.5 text-[9px] font-medium text-ink shadow-md select-none',
                    isLeft ? 'right-full mr-2' : 'left-full ml-2',
                  )}
                >
                  {label}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default memo(MagneticHandle);
