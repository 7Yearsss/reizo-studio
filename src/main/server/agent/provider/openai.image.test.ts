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

  it('turns a gateway url-only image response into b64_json before the SDK parses it', async () => {
    const png = Buffer.from('image-bytes');
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/images/generations')) {
        return Response.json({ created: 1, data: [{ url: 'https://cdn.test/a.png', revised_prompt: 'cat' }] });
      }
      if (url === 'https://cdn.test/a.png') return new Response(png);
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const provider = createOpenAiProvider({ apiKey: 'fake', baseUrl: 'https://example.test/v1', retryTransport: false });
    const result = await generateImage({ model: provider.image('gpt-image-2'), prompt: 'a cat', maxRetries: 0 });
    expect(Buffer.from(result.images[0].uint8Array).toString()).toBe('image-bytes');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not download an image when b64_json is already present', async () => {
    const fetch = vi.fn(async () => Response.json({ created: 1, data: [{ b64_json: Buffer.from('ready').toString('base64'), url: 'https://cdn.test/skip.png' }] }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const provider = createOpenAiProvider({ apiKey: 'fake', baseUrl: 'https://example.test/v1', retryTransport: false });
    const result = await generateImage({ model: provider.image('gpt-image-2'), prompt: 'a cat', maxRetries: 0 });
    expect(Buffer.from(result.images[0].uint8Array).toString()).toBe('ready');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
