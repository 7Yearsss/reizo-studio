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

interface PendingPermission {
  sessionId: string;
  name: string;
  args: Record<string, unknown>;
  resolve: (decision: PermissionDecision) => void;
}

const pending = new Map<string, PendingPermission>();
const pendingAsk = new Map<string, { sessionId: string; resolve: (answers: Record<string, string>) => void }>();
const sessionAllow = new Map<string, Set<string>>();
const sinks = new Map<string, (event: ChatStreamEvent) => void>();

export function setPermissionSink(sessionId: string, send: (event: ChatStreamEvent) => void): void {
  sinks.set(sessionId, send);
}

export function clearPermissionSink(sessionId: string): void {
  sinks.delete(sessionId);
  for (const [id, item] of pending) {
    if (item.sessionId === sessionId) {
      item.resolve('deny');
      pending.delete(id);
    }
  }
  for (const [id, item] of pendingAsk) {
    if (item.sessionId === sessionId) {
      item.resolve({});
      pendingAsk.delete(id);
    }
  }
}

function rememberSessionAllow(sessionId: string, name: string): void {
  const set = sessionAllow.get(sessionId) ?? new Set<string>();
  set.add(name);
  sessionAllow.set(sessionId, set);
}

function emitNextPermission(sessionId: string): void {
  for (const [id, item] of pending) {
    if (item.sessionId === sessionId) {
      sinks.get(sessionId)?.({ type: 'permission', id, name: item.name, args: item.args });
      return;
    }
  }
}

export function answerPermission(toolCallId: string, decision: PermissionDecision): boolean {
  const item = pending.get(toolCallId);
  if (!item) return false;
  pending.delete(toolCallId);

  if (decision === 'allow-session') {
    rememberSessionAllow(item.sessionId, item.name);
    item.resolve(decision);
    // Parallel waiters already passed the sessionAllow check. Resolve them
    // too so they don't sit behind a prompt the UI no longer shows.
    for (const [id, other] of pending) {
      if (other.sessionId === item.sessionId && other.name === item.name) {
        pending.delete(id);
        other.resolve('allow-session');
      }
    }
    return true;
  }

  item.resolve(decision);
  emitNextPermission(item.sessionId);
  return true;
}

export async function requestPermission(options: {
  sessionId: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  mode: PermissionMode;
  abortSignal?: AbortSignal;
}): Promise<boolean> {
  const { sessionId, toolCallId, name, args, mode, abortSignal } = options;
  const allowedTools = sessionAllow.get(sessionId);
  if (allowedTools?.has(name)) return true;
  if (!needsApproval(mode, name)) return true;
  if (name === 'run_command' && typeof args.command === 'string' && isReadOnlyShellCommand(args.command)) {
    return true;
  }

  sinks.get(sessionId)?.({ type: 'permission', id: toolCallId, name, args });

  const decision = await new Promise<PermissionDecision>((resolve) => {
    const finish = (value: PermissionDecision) => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish('deny');
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    pending.set(toolCallId, { sessionId, name, args, resolve: finish });
  });

  if (decision === 'allow-session') {
    rememberSessionAllow(sessionId, name);
    return true;
  }
  return decision === 'allow';
}

/** Test-only: drop in-memory permission state between cases. */
export function resetPermissionsForTests(): void {
  pending.clear();
  pendingAsk.clear();
  sessionAllow.clear();
  sinks.clear();
}

export function answerAsk(toolCallId: string, answers: Record<string, string>): boolean {
  const item = pendingAsk.get(toolCallId);
  if (!item) return false;
  pendingAsk.delete(toolCallId);
  item.resolve(answers);
  return true;
}

export async function requestAsk(options: {
  sessionId: string;
  toolCallId: string;
  questions: AskQuestion[];
  abortSignal?: AbortSignal;
}): Promise<Record<string, string>> {
  const { sessionId, toolCallId, questions, abortSignal } = options;
  sinks.get(sessionId)?.({ type: 'ask', id: toolCallId, questions });
  return new Promise<Record<string, string>>((resolve) => {
    const finish = (value: Record<string, string>) => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish({});
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    pendingAsk.set(toolCallId, { sessionId, resolve: finish });
  });
}
