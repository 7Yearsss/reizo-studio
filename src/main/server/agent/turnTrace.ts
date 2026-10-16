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

type TraceEvent = { type: string; [key: string]: unknown };

export function createTurnTraceCollector(options: { sessionId: string; model: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const callStart = new Map<string, number>();
  const tools: ToolTrace[] = [];
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
      } else if (event.type === 'tool_loop') {
        loopVerdicts.push({ tier: String(event.tier), reason: String(event.reason).slice(0, 200) });
      }
    },
    onContinue(reason: string) { continuePasses.push(reason); },
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
