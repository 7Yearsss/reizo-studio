import { cameraFromPreset, cameraToKlingConfig } from '../../../../shared/cameraMotion';
import type { VideoDriver, VideoDriverOptions, VideoGenerateParams, VideoJobStatus, VideoSubmission } from './types';
import { klingRemoteContextValid, providerUrl } from './remoteEndpoints';
import { VideoPollError } from './types';

/**
 * 可灵 (Kling) 官方 API 视频生成驱动
 * 规范: POST /v1/videos/text2video or /image2video -> GET /v1/videos/text2video/{taskId}
 */
export const klingDriver: VideoDriver = {
  id: 'kling',
  name: '可灵 AI (Kling 官方)',
  supportsRecovery: true,
  defaultModel: 'kling-v1',
  validateRemoteContext: klingRemoteContextValid,

  async submit(
    params: VideoGenerateParams,
    options: VideoDriverOptions,
  ): Promise<VideoSubmission> {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('Kling API key is missing');

    const baseUrl = providerUrl(options.baseUrl || 'https://api.klingai.com').href.replace(/\/$/, '');
    const queryPath = params.startImageBytes || params.referenceImages?.length ? '/v1/videos/image2video' : '/v1/videos/text2video';
    const endpoint = `${baseUrl}${queryPath}`;

    const body: Record<string, unknown> = {
      model_name: params.model || 'kling-v1',
      prompt: params.prompt,
      duration: params.duration === '10s' ? '10' : '5',
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
    } else if (params.referenceImages && params.referenceImages.length > 0) {
      body.image = Buffer.from(params.referenceImages[0].bytes).toString('base64');
    }
    if (params.endImageBytes) {
      body.image_tail = Buffer.from(params.endImageBytes).toString('base64');
    }
    if (params.referenceImages && params.referenceImages.length > 0) {
      body.elements = params.referenceImages.map((ref) => ({
        image: Buffer.from(ref.bytes).toString('base64'),
        role: ref.role || 'character',
      }));
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal,
      redirect: 'error',
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

    return { taskId, context: { baseUrl, queryPath } };
  },

  async poll(
    taskId: string,
    options: VideoDriverOptions,
  ): Promise<VideoJobStatus> {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('Kling API key is missing');

    const context = options.context ?? { baseUrl: options.baseUrl || 'https://api.klingai.com', queryPath: '/v1/videos/text2video' };
    if (!klingRemoteContextValid(taskId, context)) throw new Error('Invalid saved Kling task context');
    const baseUrl = String(context.baseUrl).replace(/\/$/, '');
    const endpoint = `${baseUrl}${context.queryPath}/${encodeURIComponent(taskId)}`;

    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: options.signal,
      redirect: 'error',
    });

    if (!res.ok) {
      const err = await res.text();
      throw new VideoPollError(`Kling query error (${res.status}): ${err.slice(0, 200)}`, res.status === 429 || res.status >= 500);
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
      throw new VideoPollError('Invalid Kling query response', false);
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
      if (!videoUrl) throw new VideoPollError('Kling completed but returned no video url', false);
      return { status: 'succeed', progress: 100, videoUrl };
    }

    throw new VideoPollError('Kling returned an unknown task status', false);
  },
};
