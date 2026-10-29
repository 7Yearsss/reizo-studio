import { streamText } from 'ai';
import { expect, it, vi } from 'vitest';
import { createOpenAiModel } from './openai';

it('sends video tool frames as real images after all tool results, rather than base64 text', async () => {
  const jpeg = Buffer.from('video-frame').toString('base64');
  const transport = vi.fn(async () => new Response('data: {"id":"test","choices":[{"index":0,"delta":{"content":"已看到画面"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  const model = createOpenAiModel({ apiKey: 'test', modelId: 'gpt-6-astra', baseUrl: 'https://gateway.example/v1', fetch: transport });
  const messages = [
    { role: 'assistant' as const, content: [{ type: 'tool-call' as const, toolCallId: 'v1', toolName: 'analyze_video', input: {} }, { type: 'tool-call' as const, toolCallId: 'other', toolName: 'read_file', input: {} }] },
    { role: 'tool' as const, content: [
      { type: 'tool-result' as const, toolCallId: 'v1', toolName: 'analyze_video', output: { type: 'content' as const, value: [{ type: 'text' as const, text: 'Video frame at 151.86 seconds' }, { type: 'file' as const, mediaType: 'image/jpeg', data: { type: 'data' as const, data: jpeg } }] } },
    ] },
    { role: 'tool' as const, content: [
      { type: 'tool-result' as const, toolCallId: 'other', toolName: 'read_file', output: { type: 'text' as const, value: 'ordinary text' } },
    ] },
  ];
  expect(await streamText({ model, maxRetries: 0, messages }).text).toBe('已看到画面');
  const payload = JSON.parse((transport.mock.calls[0] as unknown as [unknown, RequestInit])[1].body as string);
  expect(payload.messages.map((message: { role: string }) => message.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
  expect(payload.messages[1].tool_call_id).toBe('v1'); expect(payload.messages[1].content).not.toContain(jpeg);
  expect(payload.messages[2].content).toBe('ordinary text');
  expect(payload.messages[3].content).toContainEqual({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } });
  expect(JSON.stringify(payload.messages[3])).toContain('151.86 seconds');
  expect(messages[1].content[0]).toHaveProperty('output.type', 'content');
});

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
