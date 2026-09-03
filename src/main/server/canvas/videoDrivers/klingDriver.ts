import { cameraFromPreset, cameraToKlingConfig } from '../../../../shared/cameraMotion';
import type { VideoDriver, VideoGenerateParams, VideoJobStatus } from './types';

/**
 * 可灵 (Kling) 官方 API 视频生成驱动
 * 规范: POST /v1/videos/text2video or /image2video -> GET /v1/videos/text2video/{taskId}
 */
export const klingDriver: VideoDriver = {
  id: 'kling',
  name: '可灵 AI (Kling 官方)',

  async submit(
    params: VideoGenerateParams,
    options: { apiKey?: string; baseUrl?: string },
  ): Promise<{ taskId: string }> {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('Kling API key is missing');

    const baseUrl = (options.baseUrl || 'https://api.klingai.com').replace(/\/$/, '');
    const isImageToVideo = Boolean(params.startImageBytes);
    const endpoint = isImageToVideo
      ? `${baseUrl}/v1/videos/image2video`
      : `${baseUrl}/v1/videos/text2video`;

    const body: Record<string, unknown> = {
      model: 'kling-v1',
      prompt: params.prompt,
      duration: params.duration === '10s' ? 10 : 5,
      aspect_ratio: params.ratio || '16:9',
    };

    // Kling `simple` wants the magnitude under `config` (one non-zero axis,
    // each −10..10). The old code sent `{ type: 'zoom_in' }` etc., which is not
    // a valid `camera_control.type` and was silently dropped by the API.
    const klingCamera = cameraToKlingConfig(params.camera ?? cameraFromPreset(params.cameraMotion));
    if (klingCamera) {
      body.camera_control = klingCamera;
    }

    if (params.startImageBytes) {
      body.image = Buffer.from(params.startImageBytes).toString('base64');
    }
    if (params.endImageBytes) {
      body.image_tail = Buffer.from(params.endImageBytes).toString('base64');
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kling submit error (${res.status}): ${err.slice(0, 300)}`);
    }

    const data = (await res.json()) as { data?: { task_id?: string }; message?: string };
    const taskId = data.data?.task_id;
    if (!taskId) {
      throw new Error(`Kling API error: ${data.message || 'No task_id returned'}`);
    }

    return { taskId };
  },

  async poll(
    taskId: string,
    options: { apiKey?: string; baseUrl?: string },
  ): Promise<VideoJobStatus> {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('Kling API key is missing');

    const baseUrl = (options.baseUrl || 'https://api.klingai.com').replace(/\/$/, '');
    const endpoint = `${baseUrl}/v1/videos/text2video/${taskId}`;

    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const err = await res.text();
      return { status: 'failed', error: `Kling poll error (${res.status}): ${err.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      data?: {
        task_status?: 'submitted' | 'processing' | 'succeed' | 'failed';
        task_status_msg?: string;
        task_result?: {
          videos?: Array<{ url?: string; id?: string }>;
        };
      };
    };

    const taskData = data.data;
    if (!taskData) {
      return { status: 'failed', error: 'Invalid Kling poll response' };
    }

    if (taskData.task_status === 'submitted') {
      return { status: 'pending', progress: 15 };
    }
    if (taskData.task_status === 'processing') {
      return { status: 'processing', progress: 60 };
    }
    if (taskData.task_status === 'failed') {
      return { status: 'failed', error: taskData.task_status_msg || 'Kling video generation failed' };
    }
    if (taskData.task_status === 'succeed') {
      const videoUrl = taskData.task_result?.videos?.[0]?.url;
      if (!videoUrl) return { status: 'failed', error: 'Kling succeeded but returned no video url' };
      return { status: 'succeed', progress: 100, videoUrl };
    }

    return { status: 'processing', progress: 40 };
  },
};
