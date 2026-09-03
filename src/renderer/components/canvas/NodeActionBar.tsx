import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * One entry on a node's floating action bar. The ordering the caller passes is
 * the ordering shown — keep it consistent across node types:
 * `variations → animate/carryFrame → qa → ref → save/copy`.
 */
export interface NodeAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  /** Tooltip; falls back to `label`. */
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'accent';
}

/**
 * The shared floating action bar that sits just above a canvas node. Replaces
 * the three hand-rolled `absolute -top-8` pills in ImageNode / AgentNode /
 * VideoNode so their contents can never drift apart again.
 *
 * `visible` is driven by `selected || hovered` (see {@link useHoverIntent}).
 * It stays mounted and fades so the hover→bar cursor trip doesn't unmount it
 * mid-move; `pointer-events` are dropped while hidden.
 */
export default function NodeActionBar({ visible, actions }: { visible: boolean; actions: NodeAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div
      className={cn(
        'node-action-bar nodrag absolute -top-8 left-0 z-20 flex items-center gap-1 rounded-lg border border-line bg-paper-raised/95 px-1 py-0.5 shadow-md backdrop-blur-sm',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.map((action, i) => (
        <Fragment key={action.id}>
          {i > 0 ? <span className="h-3 w-px bg-line" /> : null}
          <button
            type="button"
            disabled={action.disabled}
            title={action.title ?? action.label}
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium hover:bg-paper-inset disabled:opacity-40 disabled:hover:bg-transparent',
              action.tone === 'accent' ? 'text-accent' : 'text-ink',
            )}
          >
            {action.icon}
            {action.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Hover state with a leave grace period so the cursor can travel from the card
 * to the (visually detached) action bar without it flickering out. The bar is
 * a DOM descendant of the node root, so moving onto it does not fire the root's
 * `mouseleave` — the grace period only covers the ~8px visual gap.
 */
export function useHoverIntent(delay = 140): {
  hovered: boolean;
  hoverProps: { onMouseEnter: () => void; onMouseLeave: () => void };
} {
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onMouseEnter = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setHovered(true);
  }, []);
  const onMouseLeave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(false), delay);
  }, [delay]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { hovered, hoverProps: { onMouseEnter, onMouseLeave } };
}
