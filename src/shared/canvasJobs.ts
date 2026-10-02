import type { CanvasNodeOutput, CanvasNodeType } from './canvas';

export type CanvasJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type CanvasJobTerminalStatus = Exclude<CanvasJobStatus, 'queued' | 'running'>;
export type CanvasJobResult = CanvasNodeOutput | Record<string, unknown>;

/** The non-secret handle required to query an already submitted provider task. */
export interface CanvasRemoteTask {
  driverId: string;
  taskId: string;
  context?: Record<string, unknown>;
}

/** Persisted execution identity. Inputs contain canvas data, never provider credentials. */
export interface CanvasJob {
  id: string;
  canvasId: string;
  nodeId: string;
  nodeType: CanvasNodeType;
  generation: number;
  operationId?: string;
  status: CanvasJobStatus;
  input: Record<string, unknown>;
  providerId?: string;
  model?: string;
  inputHash?: string;
  remoteTask?: CanvasRemoteTask;
  result?: CanvasJobResult;
  error?: string;
  cancelReason?: string;
  createdAt: string;
  submittedAt?: string;
  endedAt?: string;
}

export interface CanvasJobEnqueueInput {
  canvasId: string;
  nodeId: string;
  nodeType: CanvasNodeType;
  input: Record<string, unknown>;
  operationId?: string;
  providerId?: string;
  model?: string;
  inputHash?: string;
}

export interface CanvasJobFinish {
  result?: CanvasJobResult;
  error?: string;
  cancelReason?: string;
}

export function isCanvasJobTerminal(status: CanvasJobStatus): status is CanvasJobTerminalStatus {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}
