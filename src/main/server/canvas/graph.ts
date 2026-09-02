import type { CanvasEdge, CanvasNode } from '../../../shared/canvas';

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
