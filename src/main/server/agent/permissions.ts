import type { PermissionMode } from '../../../shared/settings';
import type { AskQuestion, ChatStreamEvent } from '../../../shared/stream';

export type PermissionDecision = 'allow' | 'deny' | 'allow-session';

const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const SHELL_TOOLS = new Set(['run_command']);

/** Git subcommands that only inspect the repo. Mirrors Claude Code's read-only git set, kept tight. */
const READ_ONLY_GIT = /^(git\s+)(status|diff|log|show|rev-parse|describe|ls-files)(\s|$)/;
const READ_ONLY_GIT_REMOTE = /^git\s+remote(\s+(-v|--verbose))?\s*$/;

export function needsApproval(mode: PermissionMode, toolName: string): boolean {
  if (mode === 'full') return false;
  if (WRITE_TOOLS.has(toolName)) return mode === 'ask';
  if (SHELL_TOOLS.has(toolName)) return true;
  return false;
}

export function isReadOnlyShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  // Reject compounds / substitutions so `git status && rm -rf` still prompts.
  if (/[;&|`$]/.test(trimmed) || trimmed.includes('\n')) return false;
  return READ_ONLY_GIT.test(trimmed) || READ_ONLY_GIT_REMOTE.test(trimmed);
}

/**
 * Thrown by a tool's `execute()` the instant it discovers it needs the user's
 * go-ahead. It never blocks: the pending interaction is recorded, this error
 * unwinds the tool call, and the AI SDK step ends. `session.ts` recognises the
 * error (via the translator's `interaction_request` event), suspends the turn
 * with every provider timer cleared, waits for the answer, then resumes with a
 * fresh provider pass. Human think-time is therefore never inside a provider
 * step budget.
 */
export interface PendingInteractionInfo {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  kind: 'permission' | 'ask';
  questions?: AskQuestion[];
}

export class ApprovalRequiredError extends Error {
  readonly interaction: PendingInteractionInfo;
  constructor(interaction: PendingInteractionInfo) {
    super('__REIZO_INTERACTION_REQUIRED__');
    this.name = 'ApprovalRequiredError';
    this.interaction = interaction;
  }
}

export function isApprovalRequiredError(value: unknown): value is ApprovalRequiredError {
  return (
    value instanceof Error &&
    (value.name === 'ApprovalRequiredError' ||
      (value as { cause?: { name?: string } }).cause?.name === 'ApprovalRequiredError')
  );
}

/** The `ApprovalRequiredError` itself, unwrapped from an SDK `ToolExecutionError` wrapper. */
export function unwrapApprovalRequiredError(value: unknown): ApprovalRequiredError | null {
  if (value instanceof ApprovalRequiredError) return value;
  const cause = (value as { cause?: unknown } | null)?.cause;
  if (cause instanceof ApprovalRequiredError) return cause;
  return null;
}

interface PendingInteraction extends PendingInteractionInfo {
  sessionId: string;
  /** Set once the user answers a `permission` interaction. */
  decision?: PermissionDecision;
  /** Set once the user answers an `ask` interaction. */
  answers?: Record<string, string>;
}

export interface ResolvedInteraction {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  kind: 'permission' | 'ask';
  decision?: PermissionDecision;
  answers?: Record<string, string>;
}

const sessionAllow = new Map<string, Set<string>>();
const sinks = new Map<string, (event: ChatStreamEvent) => void>();
/** Interaction id currently shown to the user — the queue is drained one at a time. */
const visibleInteraction = new Map<string, string>();
/** Ordered pending interactions per session (answered ones stay until consumed). */
const pending = new Map<string, PendingInteraction[]>();
const waiters = new Map<string, { promise: Promise<void>; resolve: () => void }>();

export function setPermissionSink(sessionId: string, send: (event: ChatStreamEvent) => void): void {
  sinks.set(sessionId, send);
}

export function clearPermissionSink(sessionId: string): void {
  sinks.delete(sessionId);
  visibleInteraction.delete(sessionId);
  pending.delete(sessionId);
  waiters.get(sessionId)?.resolve();
  waiters.delete(sessionId);
}

function rememberSessionAllow(sessionId: string, name: string): void {
  const set = sessionAllow.get(sessionId) ?? new Set<string>();
  set.add(name);
  sessionAllow.set(sessionId, set);
}

function isResolved(item: PendingInteraction): boolean {
  return item.kind === 'permission' ? item.decision !== undefined : item.answers !== undefined;
}

function recordPending(item: PendingInteraction): void {
  const list = pending.get(item.sessionId) ?? [];
  if (!list.some((p) => p.toolCallId === item.toolCallId)) {
    list.push(item);
    pending.set(item.sessionId, list);
  }
  emitNextInteraction(item.sessionId);
}

function emitNextInteraction(sessionId: string): void {
  if (visibleInteraction.has(sessionId)) return;
  const next = (pending.get(sessionId) ?? []).find((item) => !isResolved(item));
  if (!next) return;
  visibleInteraction.set(sessionId, next.toolCallId);
  const sink = sinks.get(sessionId);
  if (!sink) return;
  if (next.kind === 'ask') {
    console.info(`[chat] ask presented session=${sessionId} id=${next.toolCallId}`);
    sink({ type: 'ask', id: next.toolCallId, questions: next.questions ?? [] });
  } else {
    console.info(`[chat] permission presented session=${sessionId} id=${next.toolCallId} tool=${next.name}`);
    sink({ type: 'permission', id: next.toolCallId, name: next.name, args: next.args });
  }
}

function maybeResolveWaiter(sessionId: string): void {
  const list = pending.get(sessionId) ?? [];
  if (list.length > 0 && list.every(isResolved)) {
    waiters.get(sessionId)?.resolve();
    waiters.delete(sessionId);
  }
}

/**
 * Fast-path gate. Returns `true` when the tool may run immediately (mode
 * `full`, an `allow-session` grant, or an inspect-only shell command).
 * Returns `false` after recording a pending `permission` interaction — the
 * caller must then `throw new ApprovalRequiredError(...)` to unwind the step.
 */
export async function requestPermission(options: {
  sessionId: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  mode: PermissionMode;
}): Promise<boolean> {
  const { sessionId, toolCallId, name, args, mode } = options;
  if (sessionAllow.get(sessionId)?.has(name)) return true;
  if (!needsApproval(mode, name)) return true;
  if (name === 'run_command' && typeof args.command === 'string' && isReadOnlyShellCommand(args.command)) {
    return true;
  }
  recordPending({ sessionId, toolCallId, name, args, kind: 'permission' });
  return false;
}

/** Record a pending `ask` interaction. The caller then throws `ApprovalRequiredError`. */
export function registerPendingAsk(options: {
  sessionId: string;
  toolCallId: string;
  name: string;
  questions: AskQuestion[];
}): void {
  recordPending({
    sessionId: options.sessionId,
    toolCallId: options.toolCallId,
    name: options.name,
    args: {},
    kind: 'ask',
    questions: options.questions,
  });
}

export function answerPermission(toolCallId: string, decision: PermissionDecision): boolean {
  for (const [sessionId, list] of pending) {
    const item = list.find((p) => p.toolCallId === toolCallId && p.kind === 'permission');
    if (!item) continue;
    if (item.decision !== undefined) return true; // idempotent
    item.decision = decision;
    if (visibleInteraction.get(sessionId) === toolCallId) visibleInteraction.delete(sessionId);
    console.info(`[chat] permission answered session=${sessionId} id=${toolCallId} decision=${decision}`);
    if (decision === 'allow-session') {
      rememberSessionAllow(sessionId, item.name);
      // Parallel prompts for the same tool are covered by the same grant.
      for (const other of list) {
        if (other.kind === 'permission' && other.name === item.name && other.decision === undefined) {
          other.decision = 'allow-session';
        }
      }
    }
    emitNextInteraction(sessionId);
    maybeResolveWaiter(sessionId);
    return true;
  }
  return false;
}

export function answerAsk(toolCallId: string, answers: Record<string, string>): boolean {
  for (const [sessionId, list] of pending) {
    const item = list.find((p) => p.toolCallId === toolCallId && p.kind === 'ask');
    if (!item) continue;
    if (item.answers !== undefined) return true;
    item.answers = answers;
    if (visibleInteraction.get(sessionId) === toolCallId) visibleInteraction.delete(sessionId);
    console.info(`[chat] ask answered session=${sessionId} id=${toolCallId}`);
    emitNextInteraction(sessionId);
    maybeResolveWaiter(sessionId);
    return true;
  }
  return false;
}

export function hasPendingInteractions(sessionId: string): boolean {
  return (pending.get(sessionId) ?? []).length > 0;
}

/**
 * Resolves once every pending interaction for the session is answered, or
 * immediately if `signal` aborts (unanswered interactions then read as denied
 * when consumed). Never rejects.
 */
export function waitForInteractions(sessionId: string, signal?: AbortSignal): Promise<void> {
  const list = pending.get(sessionId) ?? [];
  if (list.length === 0 || list.every(isResolved)) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  let waiter = waiters.get(sessionId);
  if (!waiter) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    waiter = { promise, resolve };
    waiters.set(sessionId, waiter);
  }
  signal?.addEventListener(
    'abort',
    () => {
      waiters.get(sessionId)?.resolve();
      waiters.delete(sessionId);
    },
    { once: true },
  );
  return waiter.promise;
}

/**
 * Take the session's pending interactions as a resolved list and clear the
 * queue. Interactions the user never answered read as `deny` / `{}` so the
 * resumed pass always gets a complete tool-result set.
 */
export function consumeInteractions(sessionId: string): ResolvedInteraction[] {
  const list = pending.get(sessionId) ?? [];
  pending.delete(sessionId);
  visibleInteraction.delete(sessionId);
  return list.map((item) => ({
    toolCallId: item.toolCallId,
    name: item.name,
    args: item.args,
    kind: item.kind,
    decision: item.kind === 'permission' ? (item.decision ?? 'deny') : undefined,
    answers: item.kind === 'ask' ? (item.answers ?? {}) : undefined,
  }));
}

/** Test-only: drop in-memory permission state between cases. */
export function resetPermissionsForTests(): void {
  sessionAllow.clear();
  sinks.clear();
  visibleInteraction.clear();
  pending.clear();
  waiters.clear();
}
