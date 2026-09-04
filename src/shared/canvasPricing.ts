import type { CanvasEdge, CanvasImageParams, CanvasNode, CanvasVideoParams } from './canvas';
import { inputHash } from './canvasGraph';

/**
 * Estimates the credit/point cost for executing a single canvas node based on its
 * type, model, duration, and quality parameters.
 */
export function estimateNodeCost(node: { type: string; params?: unknown }): number {
  if (node.type === 'agent') return 1;
  if (node.type === 'image') {
    const p = node.params as CanvasImageParams | undefined;
    const model = (p?.model || '').toLowerCase();
    if (model.includes('flux-dev') || model.includes('recraft-v3')) return 2;
    if (model.includes('dall-e-3')) return 3;
    if (model.includes('midjourney')) return 2;
    return 1;
  }
  if (node.type === 'video') {
    const p = node.params as CanvasVideoParams | undefined;
    const model = (p?.model || '').toLowerCase();
    const is10s = p?.duration === '10s';
    if (model.includes('pro') || model.includes('kling-2')) {
      return is10s ? 30 : 15;
    }
    if (model.includes('minimax') || model.includes('luma') || model.includes('wan')) {
      return is10s ? 25 : 15;
    }
    return is10s ? 20 : 10;
  }
  return 0;
}

export interface GraphCostEstimate {
  totalPoints: number;
  runnableCount: number;
  cachedCount: number;
}

/**
 * Computes the total estimated cost for running the canvas (or a scoped subset),
 * differentiating between cached nodes that will be skipped and active nodes that will consume compute.
 */
export function estimateGraphCost(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  inScope?: Set<string>,
): GraphCostEstimate {
  let totalPoints = 0;
  let runnableCount = 0;
  let cachedCount = 0;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    if (inScope && !inScope.has(node.id)) continue;
    if (node.type !== 'image' && node.type !== 'video' && node.type !== 'agent') continue;

    const upEdges = edges.filter((e) => e.targetId === node.id);
    const upstreamNodes = upEdges
      .map((e) => nodeMap.get(e.sourceId))
      .filter((u): u is NonNullable<typeof u> => !!u);

    const currentHash = inputHash(node, upstreamNodes);
    const isCached = node.runState === 'done' && node.paramsHash && node.paramsHash === currentHash;

    if (isCached) {
      cachedCount += 1;
    } else {
      runnableCount += 1;
      totalPoints += estimateNodeCost(node);
    }
  }

  return { totalPoints, runnableCount, cachedCount };
}
