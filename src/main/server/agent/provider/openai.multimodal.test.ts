import { streamText } from 'ai';
import { expect, it, vi } from 'vitest';
import { createOpenAiModel } from './openai';

it('sends referenced image bytes as an OpenAI-compatible image_url and accepts a streamed reply', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const transport = vi.fn(async () => new Response([
    'data: {"id":"local","object":"chat.completion.chunk","created":1,"model":"gpt-6-astra","choices":[{"index":0,"delta":{"role":"assistant","content":"已看到图片。"},"finish_reason":null}]}',
    'data: {"id":"local","object":"chat.completion.chunk","created":1,"model":"gpt-6-astra","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } }));
  const model = createOpenAiModel({ apiKey: 'local-test-only', modelId: 'gpt-6-astra', baseUrl: 'https://gateway.example/v1', fetch: transport });
  const result = streamText({ model, maxRetries: 0, messages: [{ role: 'user', content: [
    { type: 'text', text: '帮我修改一下这张头像，高级一点' },
    { type: 'file', data: new Uint8Array(png), mediaType: 'image/png' },
  ] }] });
  expect(await result.text).toBe('已看到图片。');
  expect(transport).toHaveBeenCalledOnce();
  const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://gateway.example/v1/chat/completions');
  const payload = JSON.parse(options.body as string);
  expect(payload.model).toBe('gpt-6-astra');
  const image = payload.messages[0].content.find((part: { type: string }) => part.type === 'image_url');
  expect(image.image_url.url).toBe(`data:image/png;base64,${png.toString('base64')}`);
});
