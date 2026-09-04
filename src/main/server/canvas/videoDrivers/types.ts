import type { CameraControl } from '../../../../shared/cameraMotion';

export type { CameraControl } from '../../../../shared/cameraMotion';

export interface VideoGenerateParams {
  prompt: string;
  duration?: '5s' | '10s';
  ratio?: '16:9' | '9:16' | '1:1';
  /** @deprecated legacy preset string; drivers should read `camera`. */
  cameraMotion?: string;
  /** Structured camera motion, already clamped/normalized by the executor. */
  camera?: CameraControl;
  startImageBytes?: Uint8Array;
  endImageBytes?: Uint8Array;
  /** Reference images for multimodal conditioning (e.g. character / style references) */
  referenceImages?: Array<{ bytes: Uint8Array; role?: string }>;
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
  submit(
    params: VideoGenerateParams,
    options: { apiKey?: string; baseUrl?: string },
  ): Promise<{ taskId: string }>;
  poll(
    taskId: string,
    options: { apiKey?: string; baseUrl?: string },
  ): Promise<VideoJobStatus>;
}
