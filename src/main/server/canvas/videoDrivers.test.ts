import { afterEach, describe, expect, it, vi } from 'vitest';
import { falDriver, klingDriver, mockDriver, VideoPollError } from './videoDrivers';
import { falRemoteContextValid, klingRemoteContextValid } from './videoDrivers/remoteEndpoints';

afterEach(() => { vi.unstubAllGlobals(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('durable video query descriptors', () => {
  it.each([false, true])('pins Kling submission query mode (image input=%s) and never switches to edited provider endpoints', async (image) => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ data: { task_id: 'task' } })).mockResolvedValueOnce(json({ data: { task_status: 'processing' } }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    const submitted = await klingDriver.submit({ prompt: 'cup', ...(image ? { startImageBytes: new Uint8Array([1, 2]) } : {}) }, { apiKey: 'key', baseUrl: 'http://127.0.0.1:12345', signal });
    const mode = image ? 'image2video' : 'text2video';
    expect(submitted.context).toEqual({ baseUrl: 'http://127.0.0.1:12345', queryPath: `/v1/videos/${mode}` });
    expect(await klingDriver.poll(submitted.taskId, { apiKey: 'fresh-key', baseUrl: 'https://changed.example', context: submitted.context, signal })).toMatchObject({ status: 'processing' });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([`http://127.0.0.1:12345/v1/videos/${mode}`, `http://127.0.0.1:12345/v1/videos/${mode}/task`]);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', signal, redirect: 'error' });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model_name: 'kling-v1', duration: '5' });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ signal, headers: { Authorization: 'Bearer fresh-key' }, redirect: 'error' });
  });

  it('uses the exact FAL status/result URLs returned at submission, including a different model endpoint', async () => {
    const context = { baseUrl: 'https://queue.fal.run/fal-ai/wan/v2/image-to-video', statusUrl: 'https://queue.fal.run/fal-ai/wan/requests/id/status', responseUrl: 'https://queue.fal.run/fal-ai/wan/requests/id/response' };
    const fetcher = vi.fn().mockResolvedValueOnce(json({ request_id: 'id', status_url: context.statusUrl, response_url: context.responseUrl }))
      .mockResolvedValueOnce(json({ status: 'COMPLETED', response_url: 'https://attacker.example/leak' }))
      .mockResolvedValueOnce(json({ video: { url: 'https://v3.fal.media/result.mp4' } }));
    vi.stubGlobal('fetch', fetcher);
    const submitted = await falDriver.submit({ prompt: 'saved prompt' }, { apiKey: 'key', baseUrl: context.baseUrl });
    expect(falDriver.modelForRequest({ prompt: 'saved prompt', model: 'ignored-user-model' }, { baseUrl: context.baseUrl })).toBe('fal-ai/wan/v2/image-to-video');
    expect(submitted).toEqual({ taskId: 'id', context });
    expect(await falDriver.poll('id', { apiKey: 'fresh-key', baseUrl: 'https://changed.example', context: submitted.context })).toMatchObject({ status: 'succeed', videoUrl: 'https://v3.fal.media/result.mp4' });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([context.baseUrl, context.statusUrl, context.responseUrl]);
    expect(fetcher.mock.calls[2][1]).toMatchObject({ headers: { Authorization: 'Key fresh-key' } });
  });

  it.each([
    { statusUrl: 'https://attacker.example/fal-ai/model/requests/id/status' },
    { responseUrl: 'https://queue.fal.run/admin' },
    { responseUrl: 'https://queue.fal.run/fal-ai/other/requests/id' },
    { statusUrl: 'https://user:password@queue.fal.run/fal-ai/model/requests/id/status' },
    { statusUrl: 'https://queue.fal.run/fal-ai/model/requests/id/status?api_key=secret' },
  ])('rejects untrusted FAL task descriptor %j before sending query credentials', async (patch) => {
    const context = { baseUrl: 'https://queue.fal.run/fal-ai/model', statusUrl: 'https://queue.fal.run/fal-ai/model/requests/id/status', responseUrl: 'https://queue.fal.run/fal-ai/model/requests/id', ...patch };
    expect(falRemoteContextValid('id', context)).toBe(false);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(falDriver.poll('id', { apiKey: 'key', context })).rejects.toThrow('Invalid saved FAL');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects incomplete or credential-bearing contexts and marks the process-local mock unrecoverable', () => {
    expect(klingRemoteContextValid('id', { baseUrl: 'https://user:key@api.klingai.com', queryPath: '/v1/videos/image2video' })).toBe(false);
    expect(klingRemoteContextValid('id', { baseUrl: 'https://api.klingai.com', queryPath: '/admin' })).toBe(false);
    expect(falRemoteContextValid('id', { baseUrl: 'https://queue.fal.run/fal-ai/model' })).toBe(false);
    expect(mockDriver.supportsRecovery).toBe(false);
  });

  it.each([429, 503, 401, 404])('keeps HTTP %s query errors separate from the provider task outcome', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'query unavailable' }, status)));
    const context = { baseUrl: 'https://api.klingai.com', queryPath: '/v1/videos/text2video' };
    try {
      await klingDriver.poll('id', { apiKey: 'key', context });
      throw new Error('Expected query error');
    } catch (error) {
      expect(error).toBeInstanceOf(VideoPollError);
      expect((error as VideoPollError).retryable).toBe(status === 429 || status >= 500);
    }
  });

  it('reports a completed but unusable Kling payload as query uncertainty instead of a provider task failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: { task_status: 'succeed', task_result: {} } })));
    await expect(klingDriver.poll('id', { apiKey: 'key', context: { baseUrl: 'https://api.klingai.com', queryPath: '/v1/videos/text2video' } }))
      .rejects.toMatchObject({ retryable: false, message: 'Kling completed but returned no video url' });
  });
});
