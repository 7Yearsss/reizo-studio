import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * User-defined tool hooks, read from `<dataRoot>/hooks.json`. Deliberately user-level only:
 * a workspace file could ship commands from a cloned repo that run without the user's say-so.
 *
 *   { "hooks": [ { "event": "PreToolUse", "matcher": "edit_file|write_file",
 *                  "command": "node check.js", "timeoutMs": 10000 } ] }
 *
 * The command gets `{event, sessionId, toolName, toolInput, toolResult?}` as JSON on stdin.
 *   exit 0  -> ok; stdout may be JSON `{"decision":"block","reason":"..."}` or `{"additionalContext":"..."}`
 *   exit 2  -> block (PreToolUse) / feed stderr back to the model (PostToolUse)
 *   other   -> hook failure: logged, never blocks the tool
 * PreToolUse runs once, when the model calls the tool (before any approval card);
 * PostToolUse runs after the tool actually executed, including approved runs.
 */

export type HookEvent = 'PreToolUse' | 'PostToolUse';

export interface HookSpec {
  event: HookEvent;
  /** Regex tested against the tool name; omitted matches every tool. */
  matcher?: string;
  command: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 4_000;

/** Claude Code tool names -> ours, so plugin hooks written for Claude Code still match. */
const CLAUDE_TOOL_NAMES: Record<string, string> = {
  Write: 'write_file',
  Edit: 'edit_file',
  MultiEdit: 'edit_file',
  Bash: 'run_command',
  Read: 'read_file',
  Grep: 'grep',
  Glob: 'find_files',
  LS: 'list_dir',
};

function mapMatcher(matcher: string): string {
  if (!/^[\w|]+$/.test(matcher)) return matcher;
  return matcher.split('|').map((token) => CLAUDE_TOOL_NAMES[token] ?? token).join('|');
}

function toSpec(item: Record<string, unknown>, event: unknown, matcher: unknown): HookSpec | null {
  if (event !== 'PreToolUse' && event !== 'PostToolUse') return null;
  const { command, timeoutMs, timeout } = item;
  if (typeof command !== 'string' || !command.trim()) return null;
  if (matcher !== undefined && (typeof matcher !== 'string' || !isValidRegex(matcher))) return null;
  // Claude Code writes `timeout` in seconds; ours is `timeoutMs`.
  const ms = typeof timeoutMs === 'number' ? timeoutMs : typeof timeout === 'number' ? timeout * 1000 : 0;
  return {
    event,
    ...(typeof matcher === 'string' && matcher && matcher !== '*' ? { matcher: mapMatcher(matcher) } : {}),
    command,
    timeoutMs: ms > 0 ? Math.min(ms, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Accepts two shapes:
 *   flat (ours):   { "hooks": [ { "event", "matcher"?, "command", "timeoutMs"? } ] }
 *   nested (Claude Code plugins): { "hooks": { "PreToolUse": [ { "matcher", "hooks": [ { "type": "command", "command" } ] } ] } }
 * `unsupportedEvents` lists nested events Reizo has no equivalent for (Stop, SessionStart, ...).
 */
export function parseHooksConfigDetailed(raw: string): { hooks: HookSpec[]; unsupportedEvents: string[] } {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { hooks: [], unsupportedEvents: [] }; }
  const root = (json as { hooks?: unknown } | null)?.hooks;
  const specs: HookSpec[] = [];
  const unsupported: string[] = [];
  if (Array.isArray(root)) {
    for (const item of root) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const spec = toSpec(rec, rec.event, rec.matcher);
      if (spec) specs.push(spec);
    }
  } else if (root && typeof root === 'object') {
    for (const [event, groups] of Object.entries(root)) {
      if (event !== 'PreToolUse' && event !== 'PostToolUse') { unsupported.push(event); continue; }
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!group || typeof group !== 'object') continue;
        const { matcher, hooks } = group as { matcher?: unknown; hooks?: unknown };
        if (!Array.isArray(hooks)) continue;
        for (const hook of hooks) {
          if (!hook || typeof hook !== 'object') continue;
          const rec = hook as Record<string, unknown>;
          if (rec.type !== undefined && rec.type !== 'command') continue;
          const spec = toSpec(rec, event, matcher);
          if (spec) specs.push(spec);
        }
      }
    }
  }
  return { hooks: specs, unsupportedEvents: unsupported };
}

export function parseHooksConfig(raw: string): HookSpec[] {
  return parseHooksConfigDetailed(raw).hooks;
}

function isValidRegex(source: string): boolean {
  try { new RegExp(source); return true; } catch { return false; }
}

export async function loadHooks(dataRoot: string | undefined): Promise<HookSpec[]> {
  if (!dataRoot) return [];
  try { return parseHooksConfig(await readFile(path.join(dataRoot, 'hooks.json'), 'utf8')); } catch { return []; }
}

export function matchingHooks(hooks: HookSpec[], event: HookEvent, toolName: string): HookSpec[] {
  return hooks.filter((h) => h.event === event && (h.matcher === undefined || new RegExp(`^(?:${h.matcher})$`).test(toolName)));
}

export interface HookVerdict {
  block?: string;
  note?: string;
}

/** Interpret one finished hook process. Pure so the protocol is testable without spawning. */
export function interpretHookResult(result: { code: number | null; stdout: string; stderr: string; timedOut?: boolean }): HookVerdict {
  if (result.timedOut) return {};
  if (result.code === 2) {
    const reason = result.stderr.trim() || result.stdout.trim() || 'blocked by hook';
    return { block: reason.slice(0, MAX_OUTPUT_CHARS), note: reason.slice(0, MAX_OUTPUT_CHARS) };
  }
  if (result.code !== 0) return {};
  const text = result.stdout.trim();
  if (!text.startsWith('{')) return {};
  try {
    const parsed = JSON.parse(text) as { decision?: unknown; reason?: unknown; additionalContext?: unknown };
    const verdict: HookVerdict = {};
    if (parsed.decision === 'block') verdict.block = typeof parsed.reason === 'string' && parsed.reason ? parsed.reason.slice(0, MAX_OUTPUT_CHARS) : 'blocked by hook';
    if (typeof parsed.additionalContext === 'string' && parsed.additionalContext) verdict.note = parsed.additionalContext.slice(0, MAX_OUTPUT_CHARS);
    return verdict;
  } catch {
    return {};
  }
}

/** `shell: true` puts a shell between us and the hook, so a plain kill() would miss the real process. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  } else {
    child.kill('SIGKILL');
  }
}

function runHookProcess(spec: HookSpec, cwd: string, payload: unknown, signal?: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, { cwd, shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (s: string, chunk: Buffer) => (s.length >= MAX_OUTPUT_CHARS ? s : s + chunk.toString('utf8'));
    child.stdout.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
    let settled = false;
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, timedOut });
    };
    // Don't wait for `close` after a kill: the shell's grandchildren can keep the pipes open.
    const timer = setTimeout(() => { timedOut = true; killTree(child); done(null); }, spec.timeoutMs);
    const onAbort = () => { killTree(child); done(null); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', () => done(-1));
    child.on('close', (code) => done(code));
    child.stdin.on('error', () => { /* a hook that never reads stdin is fine */ });
    child.stdin.end(JSON.stringify(payload));
  });
}

export interface HookRunner {
  /** Throws when a PreToolUse hook blocks the call. */
  pre(toolName: string, input: unknown, signal?: AbortSignal): Promise<void>;
  /** Returns text the model should see alongside the tool result, if any hook produced one. */
  post(toolName: string, input: unknown, result: unknown, signal?: AbortSignal): Promise<string | undefined>;
}

export function createHookRunner(options: { hooks: HookSpec[]; sessionId: string; cwd: string }): HookRunner | null {
  if (options.hooks.length === 0) return null;
  const run = async (event: HookEvent, toolName: string, input: unknown, result: unknown, signal?: AbortSignal) => {
    const verdicts: HookVerdict[] = [];
    for (const spec of matchingHooks(options.hooks, event, toolName)) {
      const payload = {
        event, sessionId: options.sessionId, toolName, toolInput: input, ...(event === 'PostToolUse' ? { toolResult: result } : {}),
        // The same facts under Claude Code's field names, so scripts written for it read them unchanged.
        hook_event_name: event, session_id: options.sessionId, cwd: options.cwd, tool_name: toolName, tool_input: input,
        ...(event === 'PostToolUse' ? { tool_response: result } : {}),
      };
      const finished = await runHookProcess(spec, options.cwd, payload, signal);
      if (finished.timedOut || (finished.code !== 0 && finished.code !== 2)) {
        console.warn(`[hooks] ${event} hook failed tool=${toolName} code=${finished.code} timedOut=${finished.timedOut}`);
      }
      verdicts.push(interpretHookResult(finished));
    }
    return verdicts;
  };
  return {
    async pre(toolName, input, signal) {
      for (const verdict of await run('PreToolUse', toolName, input, undefined, signal)) {
        if (verdict.block) throw new Error(`Blocked by a user hook: ${verdict.block}`);
      }
    },
    async post(toolName, input, result, signal) {
      const notes = (await run('PostToolUse', toolName, input, result, signal)).flatMap((v) => (v.note ? [v.note] : []));
      return notes.length ? notes.join('\n') : undefined;
    },
  };
}

/** Attach a hook note to a tool result without changing its shape for the model. */
export function appendHookNote(result: unknown, note: string): unknown {
  if (typeof result === 'string') return `${result}\n\n[hook] ${note}`;
  if (result && typeof result === 'object' && !Array.isArray(result)) return { ...(result as Record<string, unknown>), hookNote: note };
  return result;
}

type ExecutableTool = { execute?: (input: never, options: never) => unknown };

/** Wrap every tool's `execute` so Pre/Post hooks run around it. */
export function wrapToolsWithHooks<T extends Record<string, unknown>>(tools: T, runner: HookRunner | null): T {
  if (!runner) return tools;
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(tools)) {
    const original = (value as ExecutableTool).execute;
    if (typeof original !== 'function') { wrapped[name] = value; continue; }
    wrapped[name] = {
      ...(value as object),
      execute: async (input: never, options: { abortSignal?: AbortSignal }) => {
        await runner.pre(name, input, options?.abortSignal);
        // A throw (including awaiting approval) skips PostToolUse: nothing ran yet, and the approved run fires it.
        const result = await (original as (i: never, o: unknown) => unknown)(input, options);
        const note = await runner.post(name, input, result, options?.abortSignal);
        return note ? appendHookNote(result, note) : result;
      },
    };
  }
  return wrapped as T;
}
