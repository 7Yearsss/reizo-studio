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
  expanded: boolean;
  /** Vertical placement, e.g. '65%'. Defaults to centre. */
  top?: string;
}) {
  const color = colorForKind(kind);
  const isLeft = position === Position.Left;

  return (
    <>
      <Handle
        type={type}
        id={id}
        position={position}
        style={{ top, ...(expanded ? { background: color, borderColor: color } : undefined) }}
        className={cn(
          'transition-all',
          expanded ? '!h-2.5 !w-2.5 !border' : '!h-2 !w-2 !border-line !bg-paper',
        )}
      />
      {expanded ? (
        <span
          style={{ top, borderColor: missing ? 'var(--danger, #ef4444)' : color }}
          className={cn(
            'pointer-events-none absolute z-10 flex -translate-y-1/2 items-center gap-0.5 whitespace-nowrap rounded-md border bg-paper-raised px-1 py-px text-[9px] font-medium leading-none text-ink shadow-sm select-none',
            isLeft ? 'right-full mr-1.5' : 'left-full ml-1.5',
          )}
        >
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: missing ? 'var(--danger, #ef4444)' : color }}
          />
          {label}
          {required ? <span style={{ color: 'var(--danger, #ef4444)' }}>*</span> : null}
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
