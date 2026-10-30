import type { AgentTrailEntry } from './agentTrail';

export interface BoxLike { id: string; x: number; y: number; w: number; h: number }
export interface CursorTarget { nodeId: string; x: number; y: number; working: boolean }

/** How long after its last action the agent's cursor lingers on a node. */
export const CURSOR_LINGER_MS = 6000;

/** A call still marked running this long after it started is treated as lost, not as live work. */
export const RUNNING_MAX_MS = 120_000;

/**
 * Where the agent's cursor should be: the centre of the first node touched by the most recent non-error trail entry,
 * while that entry is running or recent. Null when the agent is not on the canvas.
 */
export function agentCursorTarget(trail: readonly AgentTrailEntry[], nodes: readonly BoxLike[], now: number): CursorTarget | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: AgentTrailEntry | null = null;
  for (const entry of trail) {
    if (entry.status === 'error') continue;
    if (!entry.nodeIds.some((id) => byId.has(id))) continue;
    if (now - entry.at > (entry.status === 'running' ? RUNNING_MAX_MS : CURSOR_LINGER_MS)) continue;
    if (!best || entry.at >= best.at) best = entry;
  }
  if (!best) return null;
  const node = byId.get(best.nodeIds.find((id) => byId.has(id)) as string) as BoxLike;
  return { nodeId: node.id, x: node.x + node.w / 2, y: node.y + node.h / 2, working: best.status === 'running' };
}

export interface MiniPreview { label: string; working: boolean; nodeCount: number }

/**
 * The small "the agent is working on the canvas" card, for when the canvas itself is not on screen: the latest
 * non-error action while it runs or shortly after. Null when the canvas is visible (the cursor shows it there) or idle.
 */
export function agentMiniPreview(trail: readonly AgentTrailEntry[], now: number, canvasVisible: boolean): MiniPreview | null {
  if (canvasVisible) return null;
  let best: AgentTrailEntry | null = null;
  for (const entry of trail) {
    if (entry.status === 'error') continue;
    if (now - entry.at > (entry.status === 'running' ? RUNNING_MAX_MS : CURSOR_LINGER_MS)) continue;
    if (!best || entry.at >= best.at) best = entry;
  }
  return best ? { label: best.label, working: best.status === 'running', nodeCount: best.nodeIds.length } : null;
}
