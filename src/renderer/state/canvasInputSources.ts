import type { CanvasEdge, CanvasNode } from '../../shared/canvas';

export interface CanvasInputSource {
  edgeId: string;
  sourceNodeId: string;
  sourceType: string;
  sourceTitle: string;
  handleId?: string | null;
}

const empty: CanvasInputSource[] = [];
const nodeIndexes = new WeakMap<readonly CanvasNode[], Map<string, CanvasNode>>();
const inputIndexes = new WeakMap<readonly CanvasEdge[], Map<string, { nodes: readonly CanvasNode[]; sources: Map<string, CanvasInputSource[]> }>>();

export function indexedCanvasNode(nodes: readonly CanvasNode[], id: string | undefined): CanvasNode | undefined {
  if (!id) return;
  let index = nodeIndexes.get(nodes);
  if (!index) { index = new Map(nodes.map((node) => [node.id, node])); nodeIndexes.set(nodes, index); }
  return index.get(id);
}

/** Shared projection per document revision; unrelated geometry preserves each input list. */
export function canvasInputSources(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], targetId: string, imageFallback: '参考图' | '图片' | '首帧/参考图' = '参考图'): CanvasInputSource[] {
  let variants = inputIndexes.get(edges);
  if (!variants) { variants = new Map(); inputIndexes.set(edges, variants); }
  let index = variants.get(imageFallback);
  if (!index || index.nodes !== nodes) {
    const sources = new Map<string, CanvasInputSource[]>();
    for (const edge of edges) {
      const node = indexedCanvasNode(nodes, edge.sourceId);
      const source: CanvasInputSource = { edgeId: edge.id, sourceNodeId: edge.sourceId, sourceType: node?.type || 'node',
        sourceTitle: node?.title || (node?.type === 'note' ? '提示词' : node?.type === 'image' ? imageFallback : '节点'), handleId: edge.targetHandle };
      const list = sources.get(edge.targetId);
      if (list) list.push(source); else sources.set(edge.targetId, [source]);
    }
    for (const [id, list] of sources) {
      const previous = index?.sources.get(id);
      if (previous?.length === list.length && list.every((source, i) => {
        const old = previous[i];
        return old.edgeId === source.edgeId && old.sourceNodeId === source.sourceNodeId && old.sourceType === source.sourceType && old.sourceTitle === source.sourceTitle && old.handleId === source.handleId;
      })) sources.set(id, previous);
    }
    index = { nodes, sources }; variants.set(imageFallback, index);
  }
  return index.sources.get(targetId) || empty;
}
