import type { CanvasEvent } from './canvasStream';

/** Durable document changes; activity messages never advance the document cursor. */
export type CanvasDocumentChange = Extract<CanvasEvent, {
  type: 'node_added' | 'node_updated' | 'node_deleted' | 'edge_added' | 'edge_deleted' | 'run_state' | 'node_output';
}>;
export type CanvasActivityEvent = Exclude<CanvasEvent, CanvasDocumentChange | { type: 'heartbeat' }>;

export interface CanvasCommit {
  canvasId: string;
  revision: number;
  mutationId?: string;
  changes: CanvasDocumentChange[];
}

export type CanvasSyncMessage = { v: 2; canvasId: string; epoch: string } & (
  | { kind: 'commit'; commit: CanvasCommit }
  | { kind: 'activity'; event: CanvasActivityEvent }
  | { kind: 'resync'; revision: number }
  | { kind: 'heartbeat'; revision: number }
);

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const nodeStates = new Set(['idle', 'running', 'done', 'error']);
const nodeTypes = new Set(['image', 'agent', 'video', 'audio', 'note', 'group', 'anchor', 'reroute', 'frameExtractor', 'section', 'subgraph']);

function isDocumentChange(value: unknown, canvasId: string): value is CanvasDocumentChange {
  if (!object(value)) return false;
  switch (value.type) {
    case 'node_added':
    case 'node_updated': {
      const node = value.node;
      return object(node) && typeof node.id === 'string' && node.canvasId === canvasId &&
        nodeTypes.has(String(node.type)) && nodeStates.has(String(node.runState)) && object(node.params) &&
        typeof node.title === 'string' && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(node[key])) &&
        (node.output === null || object(node.output));
    }
    case 'edge_added':
      return object(value.edge) && typeof value.edge.id === 'string' && value.edge.canvasId === canvasId &&
        typeof value.edge.sourceId === 'string' && typeof value.edge.targetId === 'string';
    case 'node_deleted':
    case 'edge_deleted':
      return typeof value.id === 'string';
    case 'run_state':
      return typeof value.id === 'string' && nodeStates.has(String(value.runState));
    case 'node_output':
      return typeof value.id === 'string' && nodeStates.has(String(value.runState)) && object(value.output);
    default:
      return false;
  }
}

export function isCanvasCommit(value: unknown): value is CanvasCommit {
  if (!object(value) || typeof value.canvasId !== 'string' || !Number.isSafeInteger(value.revision) ||
      Number(value.revision) <= 0 || !Array.isArray(value.changes) || value.changes.length === 0) return false;
  return value.changes.every((change) => isDocumentChange(change, value.canvasId as string));
}

function isActivity(value: unknown): value is CanvasActivityEvent {
  if (!object(value)) return false;
  switch (value.type) {
    case 'graph_run':
      return typeof value.running === 'boolean' && typeof value.done === 'number' && typeof value.total === 'number';
    case 'phase':
      return typeof value.label === 'string';
    case 'proposal_created':
      return Array.isArray(value.nodeIds) && value.nodeIds.every((id) => typeof id === 'string');
    case 'proposal_accepted':
    case 'proposal_rejected':
      return true;
    default:
      return false;
  }
}

export function isCanvasSyncMessage(value: unknown): value is CanvasSyncMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<CanvasSyncMessage>;
  if (message.v !== 2 || typeof message.canvasId !== 'string' || typeof message.epoch !== 'string') return false;
  if (message.kind === 'commit') {
    return isCanvasCommit(message.commit) && message.commit.canvasId === message.canvasId;
  }
  if (message.kind === 'activity') return isActivity(message.event);
  return (message.kind === 'resync' || message.kind === 'heartbeat') &&
    Number.isSafeInteger(message.revision) && message.revision >= 0;
}
