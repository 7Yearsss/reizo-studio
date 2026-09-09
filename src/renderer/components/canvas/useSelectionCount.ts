import { useStore } from '@xyflow/react';

/**
 * Number of nodes currently selected on the canvas (marquee / shift-click).
 * Reads straight from the React Flow store so it updates the instant selection
 * changes, with no extra state to keep in sync.
 */
export function useSelectionCount(): number {
  return useStore((s) => {
    let n = 0;
    for (const nd of s.nodes) if (nd.selected) n += 1;
    return n;
  });
}

/**
 * True only when `selected` is this node AND it is the *sole* selection.
 *
 * Per-node heavy chrome — the generation composer (`NodeFloatingPanel`), the
 * edit params panel, corner resizers — must gate on this, not on bare
 * `selected`: marquee-selecting N nodes sets `selected` on every one of them,
 * and unfolding N composers at once buries the canvas. When 2+ nodes are
 * selected only the `MultiSelectToolbar` shows; hovering a single node still
 * reveals its own action bar.
 */
export function useIsSoloSelected(selected: boolean): boolean {
  const count = useSelectionCount();
  return selected && count <= 1;
}
