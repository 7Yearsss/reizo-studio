import { afterEach, expect, it, vi } from 'vitest';
import { newApiDriver } from './newApiDriver';
const options = { apiKey: 'fixture-only', baseUrl: 'https://gateway.example/v1', videoSupport: { startFrame: false, endFrame: false, reference: false, camera: false } };
afterEach(() => vi.unstubAllGlobals());

it('submits exact model and prompt using upstream defaults, then downloads authenticated content', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: 'video_fixture' })).mockResolvedValueOnce(Response.json({ status: 'in_progress', progress: 35 }))
    .mockResolvedValueOnce(Response.json({ status: 'completed', metadata: { url: 'https://other.example/do-not-use' } })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetcher);
  const submission = await newApiDriver.submit({ model: 'wan3.0-video', prompt: 'fixture', duration: '5s', ratio: '16:9', cameraMotion: 'none', camera: {} }, options);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: 'wan3.0-video', prompt: 'fixture' });
  expect(await newApiDriver.poll(submission.taskId, { ...options, context: submission.context })).toMatchObject({ status: 'processing', progress: 35 });
  expect(await newApiDriver.poll(submission.taskId, { ...options, context: submission.context })).toMatchObject({ status: 'succeed', videoBuffer: Buffer.from([1, 2, 3]) });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://gateway.example/v1/videos', 'https://gateway.example/v1/videos/video_fixture', 'https://gateway.example/v1/videos/video_fixture', 'https://gateway.example/v1/videos/video_fixture/content']);
  for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer fixture-only' } });
});

it('rejects unsupported references before submission and never retries an uncertain POST', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetcher);
  await expect(newApiDriver.submit({ model: 'wan', prompt: 'fixture', startImageBytes: new Uint8Array([1]) }, options)).rejects.toThrow('参考');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(newApiDriver.submit({ model: 'wan', prompt: 'fixture' }, options)).rejects.toThrow('offline');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(newApiDriver.poll('video_fixture', { ...options, context: { baseUrl: 'https://other.example/v1' } })).rejects.toMatchObject({ retryable: false });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('distinguishes rejected tasks from retryable queries and rejects path injection', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json({ status: 'failed' })); vi.stubGlobal('fetch', fetcher);
  const scoped = { ...options, context: { baseUrl: options.baseUrl } };
  await expect(newApiDriver.poll('task', scoped)).rejects.toMatchObject({ retryable: true });
  expect(await newApiDriver.poll('task', scoped)).toMatchObject({ status: 'failed' });
  await expect(newApiDriver.poll('../models', scoped)).rejects.toMatchObject({ retryable: false });
});
