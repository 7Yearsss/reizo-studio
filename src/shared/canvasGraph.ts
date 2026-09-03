import type { CanvasEdge, CanvasNode } from './canvas';

/** Direct predecessors of `nodeId` (nodes with an edge into it). */
export function directUpstream(edges: CanvasEdge[], nodeId: string): string[] {
  return edges.filter((e) => e.targetId === nodeId).map((e) => e.sourceId);
}

/** Every node transitively downstream of `nodeId` (not including itself). */
export function descendants(edges: CanvasEdge[], nodeId: string): Set<string> {
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const edge of edges) {
      if (edge.sourceId === current && !out.has(edge.targetId)) {
        out.add(edge.targetId);
        stack.push(edge.targetId);
      }
    }
  }
  return out;
}

/**
 * Kahn's algorithm. Returns the run order and whether the graph has a cycle
 * (in which case `order` holds only the acyclic prefix).
 */
export function topoOrder(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): { order: string[]; cycle: boolean } {
  const ids = new Set(nodes.map((n) => n.id));
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    adj.set(id, []);
  }
  const outEdges = (id: string): string[] => {
    let list = adj.get(id);
    if (!list) {
      list = [];
      adj.set(id, list);
    }
    return list;
  };
  for (const edge of edges) {
    if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) continue;
    outEdges(edge.sourceId).push(edge.targetId);
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
  }
  const queue = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return { order, cycle: order.length !== ids.size };
}

/**
 * Would adding `source -> target` introduce a cycle? True when `source` is
 * already reachable from `target`.
 */
export function wouldCycle(edges: CanvasEdge[], source: string, target: string): boolean {
  if (source === target) return true;
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) {
      if (edge.sourceId === current) stack.push(edge.targetId);
    }
  }
  return false;
}

/**
 * Simple layered layout: column = longest path from a root, row = order
 * within the column. Enough to "tidy" a small hand-built graph.
 */
export function layoutGraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  gap: { x?: number; y?: number } = {},
): Record<string, { x: number; y: number }> {
  const dx = gap.x ?? 380;
  const dy = gap.y ?? 260;
  const { order } = topoOrder(nodes, edges);
  const seen = new Set(order);
  const rest = nodes.map((n) => n.id).filter((id) => !seen.has(id));
  const sequence = [...order, ...rest];

  const col = new Map<string, number>();
  for (const id of sequence) {
    const ups = directUpstream(edges, id).filter((u) => col.has(u));
    col.set(id, ups.length ? Math.max(...ups.map((u) => col.get(u) ?? 0)) + 1 : 0);
  }
  const rowCursor = new Map<number, number>();
  const out: Record<string, { x: number; y: number }> = {};
  for (const id of sequence) {
    const c = col.get(id) ?? 0;
    const r = rowCursor.get(c) ?? 0;
    rowCursor.set(c, r + 1);
    out[id] = { x: 40 + c * dx, y: 40 + r * dy };
  }
  return out;
}

/**
 * Stable hash of everything that determines a node's output: its own params
 * plus the identity + last output of each direct upstream node. Compared
 * against the stored `paramsHash` (written on a successful run) to tell
 * whether a node has drifted "stale" since it last ran.
 */
export function inputHash(node: CanvasNode, upstream: CanvasNode[]): string {
  const up = [...upstream]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({ id: n.id, assets: n.output?.assets ?? [], text: n.output?.text ?? null }));
  return JSON.stringify({ params: node.params, up });
}

/**
 * Returns waves of runnable node IDs in topological dependency order.
 * Nodes in the same wave have no mutual dependencies and can execute in parallel.
 *
 * `inScope`: optional subset of node IDs to consider (e.g. fromNodeId descendants or group members).
 * `isRunnable`: predicate testing if a node type can be executed.
 */
export function buildPipelineWaves(
  nodes: { id: string; type: string }[],
  edges: { sourceId: string; targetId: string }[],
  isRunnable: (type: string) => boolean,
  inScope?: Set<string>,
): string[][] {
  const runnableIds = new Set(
    nodes
      .filter((n) => isRunnable(n.type) && (!inScope || inScope.has(n.id)))
      .map((n) => n.id),
  );
  if (runnableIds.size === 0) return [];

  // Build direct upstream lookup
  const upstreamMap = new Map<string, string[]>();
  for (const edge of edges) {
    if (!inScope || (inScope.has(edge.sourceId) && inScope.has(edge.targetId))) {
      let list = upstreamMap.get(edge.targetId);
      if (!list) {
        list = [];
        upstreamMap.set(edge.targetId, list);
      }
      list.push(edge.sourceId);
    }
  }

  // Find upstream runnable dependencies for each runnable node (walking through intermediate non-runnables if any)
  const deps = new Map<string, Set<string>>();
  for (const id of runnableIds) {
    const nodeDeps = new Set<string>();
    const visited = new Set<string>();
    const queue = [...(upstreamMap.get(id) ?? [])];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      if (runnableIds.has(curr)) {
        nodeDeps.add(curr);
        // Do not traverse past an upstream runnable node because that runnable node will enforce its own dependencies
      } else {
        queue.push(...(upstreamMap.get(curr) ?? []));
      }
    }
    deps.set(id, nodeDeps);
  }

  const remaining = new Set(runnableIds);
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const wave = [...remaining].filter((id) =>
      [...(deps.get(id) ?? [])].every((dep) => !remaining.has(dep)),
    );
    if (wave.length === 0) {
      // Cycle guard: append all remaining nodes and exit
      waves.push([...remaining]);
      break;
    }
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
    }
  }

  return waves;
}

