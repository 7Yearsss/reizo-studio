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

/** Live query observation. Rebuilt from the provider after restart, never a terminal outcome. */
export interface CanvasJobObservation {
  status: 'queued' | 'processing' | 'reconnecting' | 'downloading';
  progress?: number;
  observedAt: string;
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
  observation?: CanvasJobObservation;
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

export type CanvasJobSummary = Omit<CanvasJob, 'input' | 'result'> & { nodeTitle?: string; isCurrent?: boolean; nodeExists?: boolean };
export interface CanvasJobPage { jobs: CanvasJobSummary[]; nextCursor?: string }

export function isCanvasJobTerminal(status: CanvasJobStatus): status is CanvasJobTerminalStatus {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}
