import type { VideoDriver, VideoDriverOptions, VideoGenerateParams, VideoJobStatus, VideoSubmission } from './types';
import { falRemoteContextValid, providerUrl } from './remoteEndpoints';
import { VideoPollError } from './types';

/**
 * FAL.ai 视频生成驱动 (支持 Kling, WAN 2.1, Luma 等模型队列)
 * 采用 FAL 官方队列协议: POST submit -> GET status -> GET response
 */
export const falDriver: VideoDriver = {
  id: 'fal',
  name: 'FAL.ai (Kling / Wan 2.1)',
  supportsRecovery: true,
  modelForRequest(_params, options) {
    const endpoint = providerUrl(options.baseUrl || 'https://queue.fal.run/fal-ai/kling-video/v1/standard/text-to-video');
    return endpoint.pathname.replace(/^\//, '') || endpoint.href;
  },
  validateRemoteContext: falRemoteContextValid,

  async submit(
    params: VideoGenerateParams,
    options: VideoDriverOptions,
  ): Promise<VideoSubmission> {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('FAL.ai API key is missing');

    const modelEndpoint = providerUrl(options.baseUrl || 'https://queue.fal.run/fal-ai/kling-video/v1/standard/text-to-video').href.replace(/\/$/, '');
    // FAL's kling endpoint has no structured `camera_control` channel — camera
    // motion reaches it as the natural-language suffix the executor already
    // appended to `params.prompt` (see `cameraToPrompt`).
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      duration: params.duration === '10s' ? '10' : '5',
      aspect_ratio: params.ratio || '16:9',
    };

    if (params.startImageBytes) {
      body.image_url = `data:image/png;base64,${Buffer.from(params.startImageBytes).toString('base64')}`;
    } else if (params.referenceImages && params.referenceImages.length > 0) {
      body.image_url = `data:image/png;base64,${Buffer.from(params.referenceImages[0].bytes).toString('base64')}`;
    }
    if (params.endImageBytes) {
      body.end_image_url = `data:image/png;base64,${Buffer.from(params.endImageBytes).toString('base64')}`;
    }
    if (params.referenceImages && params.referenceImages.length > 0) {
      body.reference_image_urls = params.referenceImages.map(
        (ref) => `data:image/png;base64,${Buffer.from(ref.bytes).toString('base64')}`,
      );
    }

    const res = await fetch(modelEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal,
      redirect: 'error',
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FAL submit error (${res.status}): ${err.slice(0, 300)}`);
    }

    const data = (await res.json()) as { request_id?: string; status_url?: string; response_url?: string };
    if (!data.request_id) {
      throw new Error('FAL response missing request_id');
    }

    const context = { baseUrl: modelEndpoint, statusUrl: data.status_url, responseUrl: data.response_url };
    if (!falRemoteContextValid(data.request_id, context)) throw new Error('FAL returned untrusted or incomplete task endpoints');
    return { taskId: data.request_id, context };
  },

  async poll(
    taskId: string,
    options: VideoDriverOptions,
  ): Promise<VideoJobStatus> {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('FAL.ai API key is missing');

    if (!falRemoteContextValid(taskId, options.context)) throw new Error('Invalid saved FAL task context');
    const statusUrl = String(options.context.statusUrl);
    const res = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
      signal: options.signal,
      redirect: 'error',
    });

    if (!res.ok) {
      const err = await res.text();
      throw new VideoPollError(`FAL query error (${res.status}): ${err.slice(0, 200)}`, res.status === 429 || res.status >= 500);
    }

    const data = (await res.json()) as {
      status?: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      response_url?: string;
      error?: string;
      logs?: Array<{ message: string }>;
    };

    if (data.status === 'IN_QUEUE') {
      return { status: 'pending', progress: 10 };
    }
    if (data.status === 'IN_PROGRESS') {
      return { status: 'processing', progress: 50 };
    }
    if (data.status === 'FAILED') {
      return { status: 'failed', error: data.error || 'Video generation failed' };
    }

    if (data.status === 'COMPLETED') {
      if (data.error) return { status: 'failed', error: data.error };
      const responseUrl = String(options.context.responseUrl);
      const resultRes = await fetch(responseUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        signal: options.signal,
        redirect: 'error',
      });
      if (!resultRes.ok) {
        throw new VideoPollError(`FAL result query error (${resultRes.status})`, resultRes.status === 429 || resultRes.status >= 500);
      }
      const resultData = (await resultRes.json()) as { video?: { url?: string } };
      const videoUrl = resultData.video?.url;
      if (!videoUrl) {
        throw new VideoPollError('FAL completed but returned no video url', false);
      }
      return { status: 'succeed', progress: 100, videoUrl };
    }

    throw new VideoPollError('FAL returned an unknown task status', false);
  },
};
