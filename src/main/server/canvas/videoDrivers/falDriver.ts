import type { VideoDriver, VideoGenerateParams, VideoJobStatus } from './types';

/**
 * FAL.ai 视频生成驱动 (支持 Kling, WAN 2.1, Luma 等模型队列)
 * 采用 FAL 官方队列协议: POST submit -> GET status -> GET response
 */
export const falDriver: VideoDriver = {
  id: 'fal',
  name: 'FAL.ai (Kling / Wan 2.1)',

  async submit(
    params: VideoGenerateParams,
    options: { apiKey?: string; baseUrl?: string },
  ): Promise<{ taskId: string }> {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('FAL.ai API key is missing');

    const modelEndpoint = options.baseUrl || 'https://queue.fal.run/fal-ai/kling-video/v1/standard/text-to-video';
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      duration: params.duration === '10s' ? '10' : '5',
      aspect_ratio: params.ratio || '16:9',
    };

    if (params.startImageBytes) {
      body.image_url = `data:image/png;base64,${Buffer.from(params.startImageBytes).toString('base64')}`;
    }
    if (params.endImageBytes) {
      body.end_image_url = `data:image/png;base64,${Buffer.from(params.endImageBytes).toString('base64')}`;
    }

    const res = await fetch(modelEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FAL submit error (${res.status}): ${err.slice(0, 300)}`);
    }

    const data = (await res.json()) as { request_id?: string; status_url?: string };
    if (!data.request_id) {
      throw new Error('FAL response missing request_id');
    }

    return { taskId: data.request_id };
  },

  async poll(
    taskId: string,
    options: { apiKey?: string; baseUrl?: string },
  ): Promise<VideoJobStatus> {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('FAL.ai API key is missing');

    const statusUrl = `https://queue.fal.run/fal-ai/kling-video/requests/${taskId}/status`;
    const res = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });

    if (!res.ok) {
      const err = await res.text();
      return { status: 'failed', error: `FAL poll error (${res.status}): ${err.slice(0, 200)}` };
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
      const responseUrl = data.response_url || `https://queue.fal.run/fal-ai/kling-video/requests/${taskId}`;
      const resultRes = await fetch(responseUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      if (!resultRes.ok) {
        return { status: 'failed', error: 'Failed to fetch completed video payload' };
      }
      const resultData = (await resultRes.json()) as { video?: { url?: string } };
      const videoUrl = resultData.video?.url;
      if (!videoUrl) {
        return { status: 'failed', error: 'No video url in completed response' };
      }
      return { status: 'succeed', progress: 100, videoUrl };
    }

    return { status: 'processing', progress: 30 };
  },
};
