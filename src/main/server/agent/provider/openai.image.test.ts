import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImage } from 'ai';
import { createOpenAiProvider } from './openai';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('paid image transport retry policy', () => {
  it('a durable image attempt sends one HTTP request on a retryable gateway failure', async () => {
    const fetch = vi.fn(async () => Response.json({ error: { message: 'Unavailable', type: 'server_error' } }, { status: 502 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const provider = createOpenAiProvider({ apiKey: 'fake', baseUrl: 'https://example.test/v1', retryTransport: false });
    await expect(generateImage({ model: provider.image('gpt-image-2'), prompt: 'image', maxRetries: 0 })).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('default provider transport retains its retry behavior', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'Unavailable', type: 'server_error' } }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = createOpenAiProvider({ apiKey: 'fake', baseUrl: 'https://example.test/v1' });
    const image = generateImage({ model: provider.image('gpt-image-2'), prompt: 'image', maxRetries: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    await image;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
