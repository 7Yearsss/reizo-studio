import type { CanvasEdge, CanvasNode } from '../../shared/canvas';
import type { CanvasCommit, CanvasDocumentChange, CanvasSyncMessage } from '../../shared/canvasSync';

export interface CanvasDocument {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasSyncCursor {
  canvasId: string;
  revision: number;
  epoch: string | null;
}

export type CanvasSyncDecision =
  | { kind: 'ignore' }
  | { kind: 'commit'; cursor: CanvasSyncCursor; commit: CanvasCommit }
  | { kind: 'activity'; cursor: CanvasSyncCursor; event: Extract<CanvasSyncMessage, { kind: 'activity' }>['event'] }
  | { kind: 'heartbeat'; cursor: CanvasSyncCursor }
  | { kind: 'resync'; epoch: string };

/** Document revisions belong to complete commits, never transient activity. */
export function inspectCanvasSyncMessage(cursor: CanvasSyncCursor, message: CanvasSyncMessage): CanvasSyncDecision {
  if (message.canvasId !== cursor.canvasId) return { kind: 'ignore' };
  if (cursor.epoch !== null && message.epoch !== cursor.epoch) return { kind: 'resync', epoch: message.epoch };
  const next = { ...cursor, epoch: message.epoch };
  switch (message.kind) {
    case 'resync':
      return { kind: 'resync', epoch: message.epoch };
    case 'heartbeat':
      return message.revision !== cursor.revision
        ? { kind: 'resync', epoch: message.epoch }
        : { kind: 'heartbeat', cursor: next };
    case 'activity':
      return { kind: 'activity', cursor: next, event: message.event };
    case 'commit':
      if (message.commit.canvasId !== cursor.canvasId || message.commit.revision <= cursor.revision) return { kind: 'ignore' };
      if (message.commit.revision !== cursor.revision + 1) return { kind: 'resync', epoch: message.epoch };
      return { kind: 'commit', cursor: { ...next, revision: message.commit.revision }, commit: message.commit };
  }
}

/** Pure projection: a transaction becomes one document update with stable untouched references. */
export function projectCanvasChanges(document: CanvasDocument, changes: CanvasDocumentChange[]): CanvasDocument {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const edges = new Map(document.edges.map((edge) => [edge.id, edge]));
  let nodesChanged = false; let edgesChanged = false;
  const touching = new Map<string, Set<string>>();
  const needCascade = changes.some((change) => change.type === 'node_deleted');
  const indexEdge = (edge: CanvasEdge) => {
    if (!needCascade) return;
    for (const id of [edge.sourceId, edge.targetId]) {
      const ids = touching.get(id) ?? new Set(); ids.add(edge.id); touching.set(id, ids);
    }
  };
  for (const edge of edges.values()) indexEdge(edge);
  const removeEdge = (id: string) => {
    const edge = edges.get(id); if (!edge) return;
    edges.delete(id); edgesChanged = true;
    touching.get(edge.sourceId)?.delete(id); touching.get(edge.targetId)?.delete(id);
  };
  for (const change of changes) {
    if (change.type === 'node_added') {
      if (!nodes.has(change.node.id)) { nodes.set(change.node.id, change.node); nodesChanged = true; }
    } else if (change.type === 'node_updated') {
      if (nodes.has(change.node.id) && nodes.get(change.node.id) !== change.node) { nodes.set(change.node.id, change.node); nodesChanged = true; }
    } else if (change.type === 'run_state' || change.type === 'node_output') {
      const node = nodes.get(change.id);
      if (node && (node.runState !== change.runState || change.type === 'node_output' && node.output !== change.output)) {
        nodes.set(change.id, change.type === 'run_state' ? { ...node, runState: change.runState } : { ...node, runState: change.runState, output: change.output });
        nodesChanged = true;
      }
    } else if (change.type === 'node_deleted') {
      nodesChanged = nodes.delete(change.id) || nodesChanged;
      for (const id of [...(touching.get(change.id) ?? [])]) removeEdge(id);
    } else if (change.type === 'edge_added') {
      if (!edges.has(change.edge.id)) { edges.set(change.edge.id, change.edge); indexEdge(change.edge); edgesChanged = true; }
    } else if (change.type === 'edge_deleted') removeEdge(change.id);
  }
  return !nodesChanged && !edgesChanged ? document : { nodes: nodesChanged ? [...nodes.values()] : document.nodes, edges: edgesChanged ? [...edges.values()] : document.edges };
}
