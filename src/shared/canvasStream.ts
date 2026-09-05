import type { CanvasEdge, CanvasNode, NodeRunState, CanvasNodeOutput } from './canvas';

/**
 * Canvas live-channel events. Mirrors the chat `LiveEnvelope` pattern
 * (`src/shared/liveRevision.ts`) but on its own monotonic `rev` per canvas
 * and with no terminal `done` — the stream is long-lived.
 */
export type CanvasEvent =
  | { type: 'node_added'; node: CanvasNode; operationId?: string }
  | { type: 'node_updated'; node: CanvasNode; operationId?: string }
  | { type: 'node_deleted'; id: string; operationId?: string }
  | { type: 'edge_added'; edge: CanvasEdge; operationId?: string }
  | { type: 'edge_deleted'; id: string; operationId?: string }
  | { type: 'run_state'; id: string; runState: NodeRunState; operationId?: string }
  | { type: 'node_output'; id: string; output: CanvasNodeOutput; runState: NodeRunState; operationId?: string }
  | { type: 'graph_run'; running: boolean; done: number; total: number; operationId?: string }
  | { type: 'proposal_created'; nodeIds: string[]; operationId?: string }
  | { type: 'proposal_accepted'; operationId?: string }
  | { type: 'proposal_rejected'; operationId?: string }
  | { type: 'heartbeat' };

export interface CanvasEnvelope {
  v: 1;
  canvasId: string;
  rev: number;
  epoch: string;
  event: CanvasEvent;
}

export function isCanvasEnvelope(value: unknown): value is CanvasEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CanvasEnvelope>;
  return (
    v.v === 1 &&
    typeof v.canvasId === 'string' &&
    typeof v.rev === 'number' &&
    typeof v.epoch === 'string' &&
    !!v.event &&
    typeof (v.event as { type?: unknown }).type === 'string'
  );
}

export function encodeCanvasEnvelope(envelope: CanvasEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}
