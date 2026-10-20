import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Per-turn structured trace: one JSON line per Turn under `<dataRoot>/traces/<sessionId>.jsonl`,
 * so "what did the model and tools actually do" is answerable without screenshots or DB digging.
 * The collector is pure; only `writeTurnTrace` touches disk and never throws into the turn.
 */

const MAX_TOOL_ROWS = 200;
const MAX_FILE_BYTES = 1_000_000;
const KEEP_LINES = 100;

export interface ToolTrace {
  name: string;
  /** Wall time from the call event to its result; absent when no start event was seen. */
  ms?: number;
  ok: boolean;
  error?: string;
}

export interface TurnTrace {
  at: string;
  sessionId: string;
  model: string;
  outcome: string;
  durationMs: number;
  steps: number;
  textChars: number;
  tools: ToolTrace[];
  toolsDropped: number;
  loopVerdicts: Array<{ tier: string; reason: string }>;
  continuePasses: string[];
  reasoningLeak: boolean;
}

export interface TraceHistorySummary {
  totalTurns: number;
  recurringToolFailures: Array<{ tool: string; failedTurns: number; totalCalls: number; sampleError?: string }>;
  singleTurnToolFailures: Array<{ tool: string; failedTurns: number; totalCalls: number; sampleError?: string }>;
  loopWarnCount: number;
  loopHaltCount: number;
  undeliveredCount: number;
  /** Turns (not events) that hit the tool-loop guard's halt tier. */
  loopHaltTurns: number;
  reasoningLeakTurns: number;
  /** Turns the continuation pass had to push because the model stopped with a deferral / open todos. */
  deferredTurns: number;
  openTodoTurns: number;
}

type TraceEvent = { type: string; [key: string]: unknown };

interface TrajectoryItem {
  name: string;
  argsText: string;
  ok: boolean;
  outputText: string;
}

export function createTurnTraceCollector(options: { sessionId: string; model: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const callStart = new Map<string, number>();
  const tools: ToolTrace[] = [];
  const trajectory: TrajectoryItem[] = [];
  let toolsDropped = 0;
  let steps = 0;
  const loopVerdicts: TurnTrace['loopVerdicts'] = [];
  const continuePasses: string[] = [];

  return {
    onEvent(event: TraceEvent) {
      if (event.type === 'status' && typeof event.step === 'number') steps = Math.max(steps, event.step + 1);
      else if (event.type === 'tool') {
        const id = String(event.id ?? '');
        const finished = event.result !== undefined || event.error !== undefined;
        if (!finished) { callStart.set(id, now()); return; }
        const began = callStart.get(id);
        callStart.delete(id);
        if (tools.length >= MAX_TOOL_ROWS) { toolsDropped += 1; return; }
        const failed = event.error !== undefined;
        tools.push({
          name: String(event.name ?? ''),
          ...(began === undefined ? {} : { ms: now() - began }),
          ok: !failed,
          ...(failed ? { error: String(event.error).slice(0, 200) } : {}),
        });
        trajectory.push({
          name: String(event.name ?? ''),
          argsText: safeStringify(event.args ?? {}),
          ok: !failed,
          outputText: failed ? String(event.error ?? '') : safeStringify(event.result ?? ''),
        });
      } else if (event.type === 'tool_loop') {
        loopVerdicts.push({ tier: String(event.tier), reason: String(event.reason).slice(0, 200) });
      }
    },
    onContinue(reason: string) { continuePasses.push(reason); },
    /**
     * Harness² D5: Render the collected tool trajectory as `[ACTION]`, `[OBSERVATION]`, and `[ERROR]`
     * blocks for post-turn lesson extraction or harness diagnosis (`obs_trunc` default 600 chars).
     */
    toTrajectoryMarkdown(obsTrunc = 600): string {
      if (trajectory.length === 0) return '(no tool calls)';
      return trajectory
        .map((item, idx) => {
          const action = `[ACTION ${idx + 1}] ${item.name}(${truncateMiddle(item.argsText, 300)})`;
          const tag = item.ok ? 'OBSERVATION' : 'ERROR';
          const body = truncateMiddle(item.outputText, obsTrunc);
          return `${action}\n[${tag} ${idx + 1}] ${body}`;
        })
        .join('\n\n');
    },
    finish(input: { outcome: string; text: string; reasoningLeak: boolean }): TurnTrace {
      return {
        at: new Date(startedAt).toISOString(),
        sessionId: options.sessionId,
        model: options.model,
        outcome: input.outcome,
        durationMs: now() - startedAt,
        steps,
        textChars: input.text.length,
        tools,
        toolsDropped,
        loopVerdicts,
        continuePasses,
        reasoningLeak: input.reasoningLeak,
      };
    },
  };
}

/**
 * Harness² B6: Aggregate multiple TurnTraces to distinguish recurring multi-turn failure
 * patterns from 1/k single-turn noise (which must not be turned into global rules).
 */
export function summarizeTraceHistory(traces: TurnTrace[]): TraceHistorySummary {
  const byTool = new Map<string, { turns: Set<number>; calls: number; sampleError?: string }>();
  let loopWarnCount = 0;
  let loopHaltCount = 0;
  let undeliveredCount = 0;
  let loopHaltTurns = 0;
  let reasoningLeakTurns = 0;
  let deferredTurns = 0;
  let openTodoTurns = 0;

  traces.forEach((t, idx) => {
    for (const v of t.loopVerdicts) {
      if (v.tier === 'warn') loopWarnCount += 1;
      else if (v.tier === 'halt') loopHaltCount += 1;
    }
    if (t.continuePasses.includes('undelivered')) undeliveredCount += 1;
    if (t.loopVerdicts.some((v) => v.tier === 'halt')) loopHaltTurns += 1;
    if (t.reasoningLeak) reasoningLeakTurns += 1;
    if (t.continuePasses.includes('deferred')) deferredTurns += 1;
    if (t.continuePasses.includes('todos')) openTodoTurns += 1;
    for (const tool of t.tools) {
      if (tool.ok) continue;
      const entry = byTool.get(tool.name) ?? { turns: new Set<number>(), calls: 0 };
      entry.turns.add(idx);
      entry.calls += 1;
      if (!entry.sampleError && tool.error) entry.sampleError = tool.error;
      byTool.set(tool.name, entry);
    }
  });

  const recurringToolFailures: TraceHistorySummary['recurringToolFailures'] = [];
  const singleTurnToolFailures: TraceHistorySummary['singleTurnToolFailures'] = [];
  for (const [tool, stat] of byTool.entries()) {
    const item = {
      tool,
      failedTurns: stat.turns.size,
      totalCalls: stat.calls,
      ...(stat.sampleError ? { sampleError: stat.sampleError } : {}),
    };
    if (stat.turns.size >= 2) recurringToolFailures.push(item);
    else singleTurnToolFailures.push(item);
  }

  return {
    totalTurns: traces.length,
    recurringToolFailures,
    singleTurnToolFailures,
    loopWarnCount,
    loopHaltCount,
    undeliveredCount,
    loopHaltTurns,
    reasoningLeakTurns,
    deferredTurns,
    openTodoTurns,
  };
}

function safeStringify(val: unknown): string {
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}…(${text.length - max} chars omitted)…${text.slice(-half)}`;
}

/** Append one trace line; trims the file to its newest lines once it grows past the cap. */
export async function writeTurnTrace(dataRoot: string, trace: TurnTrace): Promise<void> {
  try {
    const dir = path.join(dataRoot, 'traces');
    const file = path.join(dir, `${trace.sessionId.replace(/[^\w.-]/g, '_')}.jsonl`);
    await mkdir(dir, { recursive: true });
    await appendFile(file, `${JSON.stringify(trace)}\n`, 'utf8');
    if ((await stat(file)).size > MAX_FILE_BYTES) {
      const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
      await writeFile(file, `${lines.slice(-KEEP_LINES).join('\n')}\n`, 'utf8');
    }
  } catch (error) {
    console.warn(`[trace] write failed session=${trace.sessionId}: ${(error as Error).message}`);
  }
}
