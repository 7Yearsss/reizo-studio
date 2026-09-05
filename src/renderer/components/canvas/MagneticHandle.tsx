import React, { useState, useRef, useCallback, memo } from 'react';
import { Handle, Position, type HandleType, useReactFlow, useStore } from '@xyflow/react';
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
}: MagneticHandleProps) {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const hitRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const hasDraggedRef = useRef(false);
  const rf = useReactFlow();

  const isLeft = position === Position.Left;
  const isRight = position === Position.Right;
  const activeColor = colorForKind(kind);

  // Read current canvas zoom level from React Flow store
  const zoom = useStore((s) => s.transform[2]) || 1;
  // Inverse scale: maintain comfortable physical button size on screen when zoomed out
  // Clamped between 1x and 5x (supports bird's-eye view down to ~20% zoom)
  const scale = Math.min(5, Math.max(1, 1 / zoom));

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

  // Distance from node border to button center:
  // Button radius is 10px (for 20px button), plus a subtle 8px screen gap ("一丝丝的距离").
  // Multiplied by scale so the physical screen gap remains constant across all zoom levels.
  const baseRadius = 10;
  const gap = 8;
  const offsetPx = (baseRadius + gap) * scale;

  return (
    <div
      data-magnetic-handle="true"
      data-node-id={nodeId}
      data-handle-type={type}
      data-handle-id={id ?? ''}
      style={{
        top,
        left: isLeft ? `calc(0px - ${offsetPx}px)` : `calc(100% + ${offsetPx}px)`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        transformOrigin: 'center center',
      }}
      className="nodrag nopan absolute z-30 flex items-center justify-center select-none pointer-events-none magnetic-handle-wrapper"
    >
      {/* 1. Transparent true React Flow Handle (exact topological anchor centered in button) */}
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
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '1px',
          height: '1px',
          minWidth: '1px',
          minHeight: '1px',
          opacity: 0,
          border: 'none',
          background: 'transparent',
          pointerEvents: disabled ? 'none' : 'auto',
        }}
        className="!cursor-crosshair"
      />

      {/* 2. Magnetic Hit Container (~48px hit box centered on anchor) */}
      <div
        ref={hitRef}
        data-magnetic-handle="true"
        data-node-id={nodeId}
        data-handle-type={type}
        data-handle-id={id ?? ''}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className={cn(
          'relative flex h-12 w-12 items-center justify-center cursor-pointer pointer-events-auto',
          disabled && 'pointer-events-none opacity-40',
        )}
      >
        {/* 3. Visible springy plus button with magnetic translate */}
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
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
            transition: isHovered
              ? 'transform 250ms cubic-bezier(0.34, 1.8, 0.64, 1), background-color 150ms, border-color 150ms, box-shadow 150ms'
              : 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 200ms, border-color 200ms',
            borderColor: isHovered ? activeColor : 'var(--line-strong, #52525b)',
            boxShadow: isHovered ? `0 0 10px ${activeColor}55` : undefined,
          }}
          className={cn(
            'group relative flex h-5 w-5 items-center justify-center rounded-full border bg-paper-raised text-ink transition-transform active:scale-90 shadow-xs',
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
  );
}

export default memo(MagneticHandle);
