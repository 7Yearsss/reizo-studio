import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  clipSubagentResult,
  createSubagentTool,
  loadSubagentRoles,
  parseSubagentFile,
  pickReadOnlyTools,
  SUBAGENT_TOOL_NAME,
} from './subagentTools';

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
  type Exec = { execute: (input: { task: string; role?: string }, options: { toolCallId: string; messages: unknown[]; abortSignal?: AbortSignal }) => Promise<string> };

  it('runs its own loop with the given tools and returns only the final summary', async () => {
    const seen = { prompts: [] as string[] };
    const delegate = createSubagentTool({ getModel: () => scriptedModel(seen), tools: { read_file: readFile } })[SUBAGENT_TOOL_NAME] as unknown as Exec;
    const out = await delegate.execute({ task: 'what does a.txt say?' }, { toolCallId: 'c', messages: [] });
    expect(out).toBe('Found: a.txt says hello');
    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[1]).toContain('contents of a.txt: hello');
    expect(seen.prompts[0]).toContain('what does a.txt say?');
  });

  it('loads custom sub_agents/AGENT.md roles and applies specialist instructions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'subagent-role-'));
    try {
      await mkdir(path.join(root, 'agents'), { recursive: true });
      await mkdir(path.join(root, 'sub_agents', 'xlsx-auditor'), { recursive: true });
      await writeFile(
        path.join(root, 'sub_agents', 'xlsx-auditor', 'AGENT.md'),
        '---\nname: xlsx-auditor\ndescription: Audits spreadsheet formulas\ntools: [read_file, grep]\n---\nFocus on #REF! and #VALUE! formula errors.',
        'utf8',
      );
      const roles = await loadSubagentRoles([root]);
      expect(roles).toHaveLength(1);
      expect(roles[0].name).toBe('xlsx-auditor');
      expect(roles[0].tools).toEqual(['read_file', 'grep']);

      const seen = { prompts: [] as string[] };
      const delegate = createSubagentTool({
        getModel: () => scriptedModel(seen),
        tools: { read_file: readFile },
        roles,
      })[SUBAGENT_TOOL_NAME] as unknown as Exec;
      await delegate.execute({ task: 'audit sheet', role: 'xlsx-auditor' }, { toolCallId: 'c', messages: [] });
      await writeFile(path.join(root, 'agents', 'README.md'), 'This is a notes file, not a role.', 'utf8');
      expect(await loadSubagentRoles([root])).toHaveLength(1);
      expect(seen.prompts[0]).toContain('Focus on #REF! and #VALUE! formula errors.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect(parseSubagentFile('Plain instructions', 'plain')?.name).toBe('plain');
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
