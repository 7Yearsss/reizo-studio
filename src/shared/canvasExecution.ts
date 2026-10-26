import type { CanvasEdge, CanvasNode } from './canvas';
import { inputHash, isImportedMedia } from './canvasGraph';

export interface GraphRunSummary {
  runnableCount: number;
  cachedCount: number;
}

/**
 * Counts pending and cached nodes for the run confirmation. Model billing is
 * handled by the provider; the canvas has no separate credit currency.
 */
export function summarizeGraphRuns(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  inScope?: Set<string>,
): GraphRunSummary {
  let runnableCount = 0;
  let cachedCount = 0;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    if (inScope && !inScope.has(node.id)) continue;
    if (node.type !== 'image' && node.type !== 'video' && node.type !== 'agent') continue;
    if (isImportedMedia(node)) continue;

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
    }
  }

  return { runnableCount, cachedCount };
}
