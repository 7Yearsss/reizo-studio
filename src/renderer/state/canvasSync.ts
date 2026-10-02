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
  let { nodes, edges } = document;
  for (const change of changes) {
    switch (change.type) {
      case 'node_added':
        if (!nodes.some((node) => node.id === change.node.id)) nodes = [...nodes, change.node];
        break;
      case 'node_updated': {
        const index = nodes.findIndex((node) => node.id === change.node.id);
        if (index >= 0 && nodes[index] !== change.node) {
          nodes = [...nodes];
          nodes[index] = change.node;
        }
        break;
      }
      case 'node_output':
      case 'run_state': {
        const index = nodes.findIndex((node) => node.id === change.id);
        if (index < 0) break;
        const node = nodes[index];
        if (node.runState === change.runState && (change.type === 'run_state' || node.output === change.output)) break;
        nodes = [...nodes];
        nodes[index] = change.type === 'run_state'
          ? { ...node, runState: change.runState }
          : { ...node, runState: change.runState, output: change.output };
        break;
      }
      case 'node_deleted': {
        if (nodes.some((node) => node.id === change.id)) nodes = nodes.filter((node) => node.id !== change.id);
        if (edges.some((edge) => edge.sourceId === change.id || edge.targetId === change.id)) {
          edges = edges.filter((edge) => edge.sourceId !== change.id && edge.targetId !== change.id);
        }
        break;
      }
      case 'edge_added':
        if (!edges.some((edge) => edge.id === change.edge.id)) edges = [...edges, change.edge];
        break;
      case 'edge_deleted':
        if (edges.some((edge) => edge.id === change.id)) edges = edges.filter((edge) => edge.id !== change.id);
        break;
    }
  }
  return nodes === document.nodes && edges === document.edges ? document : { nodes, edges };
}
