import { isStepCount, tool, ToolLoopAgent, type LanguageModel, type ToolSet } from 'ai';
import { z } from 'zod';

/**
 * `delegate_research`: hand a context-heavy, read-only investigation to a sub-agent with its own
 * context window; only its final summary comes back, so the main conversation stays small.
 *
 * Deliberately narrow (v1): the sub-agent gets only read-only workspace tools, so it can never
 * bypass the approval and review flows, and it cannot delegate further. Several delegate calls in
 * one step run in parallel (the SDK executes a step's tool calls concurrently), capped per session.
 */

export const SUBAGENT_TOOL_NAME = 'delegate_research';
/** Workspace tools that only read. Anything not listed here is never handed to a sub-agent. */
export const READ_ONLY_TOOLS = ['read_file', 'grep', 'find_files', 'list_dir'] as const;
export const SUBAGENT_MAX_STEPS = 24;
export const SUBAGENT_MAX_CONCURRENT = 3;
const MAX_RESULT_CHARS = 8_000;

const INSTRUCTIONS = [
  'You are a research sub-agent working for a main agent. Investigate the task using only the read-only tools you have.',
  'You cannot modify anything and you cannot ask the user questions.',
  'Finish with ONE final message: the concrete findings the main agent needs (file paths, line references, short quotes, numbers).',
  'Be specific and brief. Do not describe your process. If you could not find something, say so plainly instead of guessing.',
  'Reply in the same language as the task.',
].join(' ');

export function pickReadOnlyTools<T extends Record<string, unknown>>(all: T | undefined): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  if (!all) return picked;
  for (const name of READ_ONLY_TOOLS) if (name in all) picked[name] = all[name];
  return picked;
}

export function clipSubagentResult(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'The sub-agent finished without a written answer (it may have run out of steps). Try a narrower task.';
  return trimmed.length > MAX_RESULT_CHARS ? `${trimmed.slice(0, MAX_RESULT_CHARS)}\n…(truncated)` : trimmed;
}

export function createSubagentTool(options: {
  /** Lazy: the tool is assembled before the turn's model exists. */
  getModel: () => LanguageModel;
  /** Read-only tools to hand over (already hook-wrapped by the caller if needed). */
  tools: Record<string, unknown>;
  /** Lazy for the same reason as `getModel`. */
  getProviderOptions?: () => unknown;
  maxSteps?: number;
}) {
  let running = 0;
  return {
    [SUBAGENT_TOOL_NAME]: tool({
      description:
        'Delegate a read-only investigation to a sub-agent with its own fresh context: searching or reading many files, ' +
        'tracing how something works, collecting facts across a large workspace. It returns only a short summary of findings, ' +
        'so use it when the exploration would otherwise flood this conversation. Do NOT use it for small lookups you can do ' +
        'yourself with one or two tool calls, and never for edits. Give it a complete, self-contained task (it cannot see this chat). ' +
        'Several independent delegations in the same step run in parallel.',
      inputSchema: z.object({
        task: z.string().min(1).describe('A complete, self-contained research task, including what to report back.'),
      }),
      execute: async ({ task }, { abortSignal }): Promise<string> => {
        if (running >= SUBAGENT_MAX_CONCURRENT) {
          return `Too many sub-agents are already running (limit ${SUBAGENT_MAX_CONCURRENT}). Wait for them or do this one yourself.`;
        }
        running += 1;
        try {
          const agent = new ToolLoopAgent({
            model: options.getModel(),
            instructions: INSTRUCTIONS,
            tools: options.tools as ToolSet,
            stopWhen: isStepCount(options.maxSteps ?? SUBAGENT_MAX_STEPS),
            maxRetries: 1,
            providerOptions: options.getProviderOptions?.() as never,
          });
          const result = await agent.generate({ prompt: task, abortSignal });
          return clipSubagentResult(result.text);
        } catch (error) {
          if (abortSignal?.aborted) throw error;
          return `The sub-agent failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
          running -= 1;
        }
      },
    }),
  };
}
