import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { Handle, Position, type HandleType, useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import Tooltip from '../ui/Tooltip';
import { colorForKind, type EdgeKind } from './edges/edgeStyles';
import { chromeScale } from './chromeScale';

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
 * - A persistent approach rail hangs off the left/right edge so the plus appears
 *   when the cursor *nears* the node — no need to cover the node first, then
 *   move back out to click.
 * - Hovering the rail pulls the plus toward the pointer with an elastic cubic-bezier.
 * - Clicking the plus dispatches `reizo:open-handle-menu`.
 * - Dragging starts native React Flow wire connection.
 */

/** Screen-space size of the left/right approach rail (local px, then inverse-zoomed). */
const APPROACH_W = 48;
const APPROACH_H = 84;
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
  const [approachHover, setApproachHover] = useState(false);
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
  // Inverse-compensated when zoomed out, grows √zoom when zoomed in
  // (see chromeScale); capped at 5x for bird's-eye view.
  const scale = Math.min(5, chromeScale(zoom));

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

  // Visible when the node is hovered/selected, OR the cursor is already on the
  // side rail — that's the "approach from outside" path.
  const visible = (nodeHovered || approachHover) && !isDragging;

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
    setApproachHover(false);
  }, []);

  const handleButtonPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
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

      {/* Approach rail: hangs off the node edge even while the plus is hidden, so
          nearing the node from the side is enough to pop the button. */}
      <div
        data-magnetic-handle="true"
        data-handle-approach="true"
        data-node-id={nodeId}
        data-handle-type={type}
        data-handle-id={id ?? ''}
        style={{
          top,
          left: isLeft ? 0 : '100%',
          width: APPROACH_W,
          height: APPROACH_H,
          transform: isLeft
            ? `translate(-100%, -50%) scale(${scale})`
            : `translate(0, -50%) scale(${scale})`,
          transformOrigin: isLeft ? 'right center' : 'left center',
          pointerEvents: disabled || isDragging ? 'none' : 'auto',
        }}
        className="nodrag nopan absolute z-30 flex items-center justify-center select-none magnetic-handle-wrapper"
      >
        <Tooltip
          content={tooltipText}
          side={isLeft ? 'left' : 'right'}
          wrapperClassName="flex h-full w-full items-center justify-center"
        >
          <div
            ref={hitRef}
            data-magnetic-handle="true"
            data-node-id={nodeId}
            data-handle-type={type}
            data-handle-id={id ?? ''}
            onPointerEnter={() => setApproachHover(true)}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerDown={handleButtonPointerDown}
            onClick={handleClick}
            className={cn(
              'relative flex h-full w-full items-center justify-center cursor-pointer',
              disabled && 'opacity-40',
            )}
          >
            <div
              style={{
                opacity: visible ? 1 : 0,
                transform: visible
                  ? `translate3d(${offset.x}px, ${offset.y}px, 0) scale(1)`
                  : `translate3d(${isLeft ? APPROACH_W / 2 : -APPROACH_W / 2}px, 0px, 0) scale(0.3)`,
                transition: visible
                  ? isHovered
                    ? 'transform 240ms cubic-bezier(0.34, 1.9, 0.64, 1), opacity 160ms ease'
                    : 'transform 280ms cubic-bezier(0.34, 1.7, 0.64, 1), opacity 180ms ease'
                  : 'transform 180ms cubic-bezier(0.55, 0, 1, 0.45), opacity 140ms ease',
                transformOrigin: isLeft ? 'right center' : 'left center',
                pointerEvents: 'none',
              }}
            >
              <button
                type="button"
                tabIndex={-1}
                data-magnetic-handle="true"
                data-node-id={nodeId}
                data-handle-type={type}
                data-handle-id={id ?? ''}
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
              </button>
            </div>
          </div>
        </Tooltip>
      </div>
    </>
  );
}

export default memo(MagneticHandle);
