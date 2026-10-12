import { streamText } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { withThinkTagExtraction } from './openai';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** Stream `text` split into small deltas, like a gateway would. */
function modelStreaming(text: string, chunkSize: number) {
  const pieces = text.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) ?? [];
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 't' },
          ...pieces.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
          { type: 'text-end' as const, id: 't' },
          { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: undefined }, usage },
        ],
      }),
    }),
  });
}

async function run(text: string, chunkSize: number) {
  const result = streamText({ model: withThinkTagExtraction(modelStreaming(text, chunkSize)), prompt: 'x' });
  return { text: await result.text, reasoning: (await result.reasoningText) ?? '' };
}

describe('withThinkTagExtraction', () => {
  // The exact shape stored in the database: three opening tags, only the last one closed.
  const leaked = '<think>\n正在检查文档。\n\n<think>\n我将提议修复。\n\n<think>\nThe user requested a check.\n</think>\n全文只发现 **1** 处问题。';

  it('keeps reasoning out of the reply even when earlier blocks were never closed', async () => {
    const { text, reasoning } = await run(leaked, 7);
    expect(text).not.toContain('think>');
    expect(text).not.toContain('The user requested');
    expect(text).toContain('全文只发现 **1** 处问题。');
    expect(reasoning).toContain('The user requested a check.');
  });

  it('gives the same result however the stream is chunked', async () => {
    const whole = await run(leaked, 10_000);
    const bytes = await run(leaked, 1);
    expect(bytes.text).toBe(whole.text);
  });

  it('leaves ordinary text alone', async () => {
    expect((await run('Hello **world**, 3 < 5 and <b>bold</b>.', 4)).text).toBe('Hello **world**, 3 < 5 and <b>bold</b>.');
  });
});
