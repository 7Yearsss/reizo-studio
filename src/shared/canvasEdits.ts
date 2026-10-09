import type { CanvasEdge, CanvasNode, CanvasNodeOutput, CanvasNodeParams, CanvasNodeType } from './canvas';

export interface CanvasNodeSpec {
  type: CanvasNodeType; x: number; y: number; w?: number; h?: number; title?: string; params?: CanvasNodeParams;
}
export interface CanvasEditPatch {
  x?: number; y?: number; w?: number; h?: number; title?: string; params?: CanvasNodeParams;
  output?: CanvasNodeOutput | null; runState?: CanvasNode['runState']; paramsHash?: string | null;
}

export interface CanvasEditUpload { nodeId: string; name: string; dataBase64: string; mimeType: string; role?: 'output' | 'mask' }
export type CanvasEdit =
  | { kind: 'add_node'; id: string; node: CanvasNodeSpec; patch?: CanvasEditPatch }
  | { kind: 'update_node'; id: string; patch: CanvasEditPatch }
  | { kind: 'delete_node'; id: string }
  | { kind: 'add_edge'; edge: Omit<CanvasEdge, 'canvasId'> }
  | { kind: 'delete_edge'; id: string };

export function restoreNodeEdit(node: CanvasNode): CanvasEdit {
  return { kind: 'add_node', id: node.id, node: { type: node.type, x: node.x, y: node.y, w: node.w, h: node.h,
    title: node.title, params: node.params }, patch: { output: node.output, paramsHash: node.paramsHash,
      runState: node.runState === 'running' ? 'idle' : node.runState } };
}

/** Only captures the fields being changed; provider outputs are not rolled back by a geometry edit. */
export function inverseEdits(edits: CanvasEdit[], nodes: CanvasNode[], edges: CanvasEdge[]): CanvasEdit[] {
  const inverse: CanvasEdit[] = [];
  for (const edit of edits) {
    if (edit.kind === 'add_node') inverse.unshift({ kind: 'delete_node', id: edit.id });
    else if (edit.kind === 'add_edge') inverse.unshift({ kind: 'delete_edge', id: edit.edge.id });
    else if (edit.kind === 'update_node') {
      const node = nodes.find((n) => n.id === edit.id);
      if (!node) throw new Error('待编辑节点不存在');
      const patch = Object.fromEntries(Object.keys(edit.patch).map((key) => [key, node[key as keyof CanvasNode]]));
      inverse.unshift({ kind: 'update_node', id: edit.id, patch });
    } else if (edit.kind === 'delete_edge') {
      const edge = edges.find((e) => e.id === edit.id);
      if (edge) inverse.unshift({ kind: 'add_edge', edge });
    } else {
      const node = nodes.find((n) => n.id === edit.id);
      if (!node) throw new Error('待删除节点不存在');
      const removedEdges = edges.filter((e) => e.sourceId === edit.id || e.targetId === edit.id);
      inverse.unshift(restoreNodeEdit(node), ...removedEdges.map((edge): CanvasEdit => ({ kind: 'add_edge', edge })));
    }
  }
  // Restore every node before connecting it; avoid duplicate edges removed by deleting both endpoints.
  const uniqueEdges = new Set<string>();
  return [...inverse.filter((e) => e.kind !== 'add_edge'), ...inverse.filter((e) => {
    if (e.kind !== 'add_edge' || uniqueEdges.has(e.edge.id)) return false;
    uniqueEdges.add(e.edge.id); return true;
  })];
}
