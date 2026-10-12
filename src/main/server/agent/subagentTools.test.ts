import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clipSubagentResult, createSubagentTool, pickReadOnlyTools, SUBAGENT_TOOL_NAME } from './subagentTools';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that first calls `read_file`, then answers with what it read. */
function scriptedModel(seen: { prompts: string[] }) {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async (params) => {
      seen.prompts.push(JSON.stringify(params.prompt));
      call += 1;
      if (call === 1) {
        return {
          content: [{ type: 'tool-call' as const, toolCallId: 't1', toolName: 'read_file', input: JSON.stringify({ path: 'a.txt' }) }],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text' as const, text: 'Found: a.txt says hello' }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

describe('pickReadOnlyTools', () => {
  it('hands over read-only tools only', () => {
    const all = { read_file: 1, grep: 2, write_file: 3, edit_file: 4, run_command: 5, list_dir: 6 };
    expect(Object.keys(pickReadOnlyTools(all)).sort()).toEqual(['grep', 'list_dir', 'read_file']);
    expect(pickReadOnlyTools(undefined)).toEqual({});
  });
});

describe('clipSubagentResult', () => {
  it('explains an empty answer and truncates a long one', () => {
    expect(clipSubagentResult('  ')).toContain('without a written answer');
    expect(clipSubagentResult('x'.repeat(9000)).length).toBeLessThan(8100);
    expect(clipSubagentResult(' ok ')).toBe('ok');
  });
});

describe('delegate_research tool', () => {
  const readFile = tool({
    description: 'read',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => `contents of ${path}: hello`,
  });
  type Exec = { execute: (input: { task: string }, options: { toolCallId: string; messages: unknown[]; abortSignal?: AbortSignal }) => Promise<string> };

  it('runs its own loop with the given tools and returns only the final summary', async () => {
    const seen = { prompts: [] as string[] };
    const delegate = createSubagentTool({ getModel: () => scriptedModel(seen), tools: { read_file: readFile } })[SUBAGENT_TOOL_NAME] as unknown as Exec;
    const out = await delegate.execute({ task: 'what does a.txt say?' }, { toolCallId: 'c', messages: [] });
    expect(out).toBe('Found: a.txt says hello');
    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[1]).toContain('contents of a.txt: hello');
    expect(seen.prompts[0]).toContain('what does a.txt say?');
  });

  it('turns a sub-agent failure into a result instead of failing the main turn', async () => {
    const failing = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('provider down'); } });
    const delegate = createSubagentTool({ getModel: () => failing, tools: {} })[SUBAGENT_TOOL_NAME] as unknown as Exec;
    expect(await delegate.execute({ task: 't' }, { toolCallId: 'c', messages: [] })).toContain('The sub-agent failed');
  });

  it('refuses beyond the concurrency limit', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = new MockLanguageModelV3({
      doGenerate: async () => {
        await gate;
        return { content: [{ type: 'text' as const, text: 'done' }], finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] };
      },
    });
    const delegate = createSubagentTool({ getModel: () => slow, tools: {} })[SUBAGENT_TOOL_NAME] as unknown as Exec;
    const opts: { toolCallId: string; messages: unknown[] } = { toolCallId: 'c', messages: [] };
    const running = [1, 2, 3].map(() => delegate.execute({ task: 't' }, opts));
    expect(await delegate.execute({ task: 'fourth' }, opts)).toContain('Too many sub-agents');
    release();
    expect(await Promise.all(running)).toEqual(['done', 'done', 'done']);
  });
});
