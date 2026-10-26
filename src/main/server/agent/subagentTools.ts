import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isStepCount, tool, ToolLoopAgent, type LanguageModel, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ChatStreamEvent } from '../../../shared/stream';
import { BATCH_MAX_CONCURRENCY, BATCH_MAX_TASKS, formatBatchResult, runBatch } from './batchRunner';

/**
 * `delegate_research`: hand a context-heavy, read-only investigation to a sub-agent with its own
 * context window; only its final summary comes back, so the main conversation stays small.
 *
 * Deliberately narrow (v1): the sub-agent gets only read-only workspace tools, so it can never
 * bypass the approval and review flows, and it cannot delegate further. Several delegate calls in
 * one step run in parallel (the SDK executes a step's tool calls concurrently), capped per session.
 *
 * Harness² A8: also supports custom read-only specialist roles loaded from
 * `<dir>/sub_agents/<name>/AGENT.md` or `<dir>/agents/<name>/AGENT.md`.
 * Loose markdown in those folders is ignored so a workspace notes directory is not treated as a role.
 */

export const SUBAGENT_TOOL_NAME = 'delegate_research';
/** Workspace tools that only read. Anything not listed here is never handed to a sub-agent. */
export const READ_ONLY_TOOLS = ['read_file', 'grep', 'find_files', 'list_dir'] as const;
export const SUBAGENT_MAX_STEPS = 24;
export const SUBAGENT_MAX_CONCURRENT = 3;
const MAX_RESULT_CHARS = 8_000;

export interface SubagentRole {
  name: string;
  description: string;
  instructions: string;
  /** Optional subset of READ_ONLY_TOOLS allowed for this specialist role. */
  tools?: string[];
}

const INSTRUCTIONS = [
  'You are a research sub-agent working for a main agent. Investigate the task using only the read-only tools you have.',
  'You cannot modify anything and you cannot ask the user questions.',
  'Finish with ONE final message: the concrete findings the main agent needs (file paths, line references, short quotes, numbers).',
  'Be specific and brief. Do not describe your process. If you could not find something, say so plainly instead of guessing.',
  'Reply in the same language as the task.',
].join(' ');

export function parseSubagentFile(raw: string, fallbackName: string): SubagentRole | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('---')) {
    return { name: fallbackName, description: `Specialist sub-agent: ${fallbackName}`, instructions: trimmed };
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) {
    return { name: fallbackName, description: `Specialist sub-agent: ${fallbackName}`, instructions: trimmed };
  }
  const matter = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).trim();
  const fields: Record<string, string> = {};
  for (const line of matter.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  const tools = fields.tools
    ? fields.tools
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter((t) => (READ_ONLY_TOOLS as readonly string[]).includes(t))
    : undefined;
  return {
    name: fields.name || fallbackName,
    description: fields.description || `Specialist sub-agent: ${fields.name || fallbackName}`,
    instructions: body || INSTRUCTIONS,
    ...(tools?.length ? { tools } : {}),
  };
}

/**
 * Harness² A8: Load custom sub-agent role definitions from `<dir>/sub_agents/<name>/AGENT.md`
 * or `<dir>/agents/<name>/AGENT.md`.
 */
export async function loadSubagentRoles(dirs: string[]): Promise<SubagentRole[]> {
  const byName = new Map<string, SubagentRole>();
  for (const baseDir of dirs) {
    for (const sub of ['sub_agents', 'agents']) {
      const target = path.join(baseDir, sub);
      try {
        const entries = await readdir(target, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const agentMd = path.join(target, entry.name, 'AGENT.md');
          try {
            const raw = await readFile(agentMd, 'utf8');
            const parsed = parseSubagentFile(raw, entry.name);
            if (parsed) byName.set(parsed.name, parsed);
          } catch {
            /* skip */
          }
        }
      } catch {
        /* directory absent */
      }
    }
  }
  return [...byName.values()];
}

export function formatAvailableSubagents(roles: SubagentRole[]): string {
  if (!roles.length) return '';
  return `Available specialist roles (pass \`role\` to delegate_research): ${roles.map((r) => `${r.name} (${r.description})`).join('; ')}.`;
}

export function pickReadOnlyTools<T extends Record<string, unknown>>(
  all: T | undefined,
  allowedNames: readonly string[] = READ_ONLY_TOOLS,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  if (!all) return picked;
  for (const name of READ_ONLY_TOOLS) {
    if (allowedNames.includes(name) && name in all) picked[name] = all[name];
  }
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
  /** Optional specialist roles (Harness² A8). */
  roles?: SubagentRole[];
}) {
  let running = 0;
  const roleHint = options.roles?.length ? ` ${formatAvailableSubagents(options.roles)}` : '';
  return {
    [SUBAGENT_TOOL_NAME]: tool({
      description:
        'Delegate a read-only investigation to a sub-agent with its own fresh context: searching or reading many files, ' +
        'tracing how something works, collecting facts across a large workspace. It returns only a short summary of findings, ' +
        'so use it when the exploration would otherwise flood this conversation. Do NOT use it for small lookups you can do ' +
        'yourself with one or two tool calls, and never for edits. Give it a complete, self-contained task (it cannot see this chat). ' +
        'Several independent delegations in the same step run in parallel.' +
        roleHint,
      inputSchema: z.object({
        task: z.string().min(1).describe('A complete, self-contained research task, including what to report back.'),
        role: z.string().optional().describe('Optional specialist sub-agent role name when a domain specialist fits.'),
      }),
      execute: async ({ task, role }, { abortSignal }): Promise<string> => {
        if (running >= SUBAGENT_MAX_CONCURRENT) {
          return `Too many sub-agents are already running (limit ${SUBAGENT_MAX_CONCURRENT}). Wait for them or do this one yourself.`;
        }
        running += 1;
        try {
          const matchedRole = role ? options.roles?.find((r) => r.name === role) : undefined;
          const activeTools = matchedRole?.tools?.length
            ? pickReadOnlyTools(options.tools, matchedRole.tools)
            : options.tools;
          const activeInstructions = matchedRole
            ? `${INSTRUCTIONS}\n\nSpecialist Role (${matchedRole.name}):\n${matchedRole.instructions}`
            : INSTRUCTIONS;
          const agent = new ToolLoopAgent({
            model: options.getModel(),
            instructions: activeInstructions,
            tools: activeTools as ToolSet,
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

export const BATCH_TOOL_NAME = 'run_batch';
/** Sub-agent runs one session may start through batches (a runaway loop cannot fan out forever). */
export const BATCH_DISPATCH_LIMIT = 40;

/**
 * `run_batch`: split independent, read-only investigations (up to 16) across sub-agents that run in parallel.
 * Each task is judged by its own heartbeat, so one stuck sub-agent is stopped alone; the rows stream to the UI.
 */
export function createBatchTool(options: {
  getModel: () => LanguageModel;
  tools: Record<string, unknown>;
  getProviderOptions?: () => unknown;
  roles?: SubagentRole[];
  emit?: (event: ChatStreamEvent) => void;
}) {
  let dispatched = 0;
  return {
    [BATCH_TOOL_NAME]: tool({
      description:
        'Run several independent read-only investigations at the same time, each in its own sub-agent with a fresh context ' +
        '(for example: summarise each of these 6 documents, check each of these folders). Tasks must not depend on each other and ' +
        'must be fully self-contained. Returns the status and answer of every task; a task that stalls is stopped on its own. ' +
        'Not for edits. For one or two lookups use delegate_research or do it yourself.',
      inputSchema: z.object({
        tasks: z.array(z.object({
          title: z.string().min(1).max(60).describe('Short label shown in the progress list.'),
          task: z.string().min(1).describe('A complete, self-contained task, including what to report back.'),
          role: z.string().optional().describe('Optional specialist role name.'),
        })).min(1).max(BATCH_MAX_TASKS),
        concurrency: z.number().int().min(1).max(BATCH_MAX_CONCURRENCY).optional().describe('How many run at once (default 4).'),
      }),
      execute: async ({ tasks, concurrency }, { abortSignal, toolCallId }): Promise<string> => {
        if (dispatched + tasks.length > BATCH_DISPATCH_LIMIT) {
          return `Batch refused: this conversation has already started ${dispatched} sub-agent runs and the limit is ${BATCH_DISPATCH_LIMIT}. Do the rest yourself.`;
        }
        dispatched += tasks.length;
        const rows = await runBatch({
          tasks,
          concurrency: concurrency ?? 4,
          signal: abortSignal,
          onUpdate: (snapshot) => options.emit?.({ type: 'batch', id: toolCallId, rows: snapshot.map(({ index, title, status, steps }) => ({ index, title, status, steps })) }),
          runOne: async (item, context) => {
            const matchedRole = item.role ? options.roles?.find((r) => r.name === item.role) : undefined;
            const activeTools = matchedRole?.tools?.length ? pickReadOnlyTools(options.tools, matchedRole.tools) : options.tools;
            const agent = new ToolLoopAgent({
              model: options.getModel(),
              instructions: matchedRole ? `${INSTRUCTIONS}

Specialist Role (${matchedRole.name}):
${matchedRole.instructions}` : INSTRUCTIONS,
              tools: activeTools as ToolSet,
              stopWhen: isStepCount(SUBAGENT_MAX_STEPS),
              maxRetries: 1,
              providerOptions: options.getProviderOptions?.() as never,
            });
            const result = await agent.generate({ prompt: item.task, abortSignal: context.signal, onStepFinish: () => context.heartbeat() });
            return clipSubagentResult(result.text);
          },
        });
        return formatBatchResult(rows);
      },
    }),
  };
}
