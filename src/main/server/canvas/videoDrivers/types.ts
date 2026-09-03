export interface VideoGenerateParams {
  prompt: string;
  duration?: '5s' | '10s';
  ratio?: '16:9' | '9:16' | '1:1';
  cameraMotion?: string;
  startImageBytes?: Uint8Array;
  endImageBytes?: Uint8Array;
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
