import { Handle, Position, type HandleType } from '@xyflow/react';
import { colorForKind, EDGE_COLORS, type EdgeKind } from './edges/edgeStyles';
import { cn } from '../../lib/cn';

/**
 * A typed connection point. Idle it is a bare hollow dot; when the node is
 * selected or hovered (`expanded`) it fills with its type colour and a labelled
 * capsule slides out (left handles to the left, right handles to the right).
 * Required inputs show `*` and go danger-outlined while `missing`.
 *
 * Renders as a fragment of two `position:absolute` elements — drop it directly
 * among the node root's children (the root must be `position: relative`), never
 * inside another positioned wrapper, or React Flow's connection geometry breaks.
 */
export default function NodeHandle({
  type,
  id,
  position,
  kind,
  label,
  required,
  missing,
  disabled,
  disabledReason,
  expanded,
  top,
}: {
  type: HandleType;
  id?: string;
  position: Position;
  kind: EdgeKind;
  label: string;
  required?: boolean;
  missing?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  expanded: boolean;
  /** Vertical placement, e.g. '65%'. Defaults to centre. */
  top?: string;
}) {
  const activeColor = disabled ? 'var(--line-strong, #71717a)' : colorForKind(kind);
  const isLeft = position === Position.Left;

  return (
    <>
      <Handle
        type={type}
        id={id}
        position={position}
        style={{
          top,
          borderColor: activeColor,
          background: expanded ? activeColor : 'var(--paper-raised, #18181b)',
          boxShadow: expanded ? `0 0 8px ${activeColor}66` : undefined,
        }}
        className={cn(
          'transition-all duration-150 !cursor-crosshair after:absolute after:-inset-3 after:content-[""] after:pointer-events-auto',
          disabled && 'opacity-40 !cursor-not-allowed after:pointer-events-none',
          expanded ? '!h-3.5 !w-3.5 !border-2' : '!h-3 !w-3 !border-2 hover:!scale-125',
        )}
      />
      {expanded ? (
        <span
          style={{
            top,
            borderColor: disabled ? 'var(--line, #52525b)' : missing ? 'var(--danger, #ef4444)' : activeColor,
          }}
          className={cn(
            'pointer-events-none absolute z-10 flex -translate-y-1/2 items-center gap-0.5 whitespace-nowrap rounded-md border bg-paper-raised px-1 py-px text-[9px] font-medium leading-none text-ink shadow-sm select-none',
            disabled && 'opacity-60 text-ink-muted bg-paper-inset',
            isLeft ? 'right-full mr-1.5' : 'left-full ml-1.5',
          )}
        >
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: disabled ? 'var(--line-strong, #71717a)' : missing ? 'var(--danger, #ef4444)' : activeColor,
            }}
          />
          {label}
          {disabled ? <span className="text-[8px] text-amber-500 font-normal">({disabledReason || '当前模型不支持'})</span> : null}
          {required && !disabled ? <span style={{ color: 'var(--danger, #ef4444)' }}>*</span> : null}
        </span>
      ) : null}
    </>
  );
}

/**
 * A stack of same-type reference slots that grows as they fill: always shows
 * one empty slot for the next connection, up to `max`. Slot ids are
 * `ref_1`, `ref_2`, … — the executor orders reference images by that number.
 */
export function ProgressiveRefHandles({
  connectedCount,
  expanded,
  max = 3,
  label = '参考',
  topStart = 0.26,
  gap = 0.13,
}: {
  connectedCount: number;
  expanded: boolean;
  max?: number;
  label?: string;
  topStart?: number;
  gap?: number;
}) {
  const slots = Math.max(1, Math.min(max, connectedCount + 1));
  return (
    <>
      {Array.from({ length: slots }, (_, i) => (
        <NodeHandle
          key={`ref_${i + 1}`}
          type="target"
          id={`ref_${i + 1}`}
          position={Position.Left}
          kind="reference"
          label={`${label} ${i + 1}`}
          expanded={expanded}
          top={`${Math.round((topStart + i * gap) * 100)}%`}
        />
      ))}
      {expanded && connectedCount > 0 && connectedCount < max ? (
        <span
          style={{ top: `${Math.round((topStart + slots * gap) * 100)}%`, color: EDGE_COLORS.reference }}
          className="pointer-events-none absolute right-full mr-1.5 -translate-y-1/2 whitespace-nowrap text-[8px] leading-none opacity-70 select-none"
        >
          可连更多参考
        </span>
      ) : null}
    </>
  );
}
