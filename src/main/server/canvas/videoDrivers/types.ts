import type { CameraControl } from '../../../../shared/cameraMotion';

export type { CameraControl } from '../../../../shared/cameraMotion';

export interface VideoGenerateParams {
  prompt: string;
  duration?: '5s' | '10s';
  ratio?: '16:9' | '9:16' | '1:1';
  model?: string;
  /** @deprecated legacy preset string; drivers should read `camera`. */
  cameraMotion?: string;
  /** Structured camera motion, already clamped/normalized by the executor. */
  camera?: CameraControl;
  startImageBytes?: Uint8Array;
  endImageBytes?: Uint8Array;
  /** Reference images for multimodal conditioning (e.g. character / style references) */
  referenceImages?: Array<{ bytes: Uint8Array; role?: string }>;
}

export interface VideoDriverOptions {
  apiKey?: string;
  baseUrl?: string;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface VideoSubmission { taskId: string; context?: Record<string, unknown> }

/** Query failures describe transport certainty, separately from a provider's failed task outcome. */
export class VideoPollError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export interface VideoJobStatus {
  status: 'pending' | 'processing' | 'succeed' | 'failed';
  progress?: number; // 0 to 100
  videoUrl?: string;
  videoBuffer?: Buffer;
  error?: string;
}

export interface VideoDriver {
  id: string;
  name: string;
  supportsRecovery?: boolean;
  defaultModel?: string;
  modelForRequest?(params: VideoGenerateParams, options: VideoDriverOptions): string;
  validateRemoteContext?(taskId: string, context?: Record<string, unknown>): boolean;
  submit(
    params: VideoGenerateParams,
    options: VideoDriverOptions,
  ): Promise<VideoSubmission>;
  poll(
    taskId: string,
    options: VideoDriverOptions,
  ): Promise<VideoJobStatus>;
}
