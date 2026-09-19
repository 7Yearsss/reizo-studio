import type { PermissionMode } from '../../../shared/settings';
import type { AskQuestion, ChatStreamEvent, FileDiffPreview } from '../../../shared/stream';

export type PermissionDecision = 'allow' | 'deny' | 'allow-session';

const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const SHELL_TOOLS = new Set(['run_command']);
/**
 * Tools that drive the user's real machine (mouse / keyboard / screen). Always
 * gated on first use regardless of `permissionMode` — even `full` prompts once,
 * then `allow-session` lets the agent run the rest of the turn uninterrupted.
 */
const CONTROL_TOOLS = new Set(['computer']);

/** Git subcommands that only inspect the repo. Mirrors Claude Code's read-only git set, kept tight. */
const READ_ONLY_GIT = /^(git\s+)(status|diff|log|show|rev-parse|describe|ls-files)(\s|$)/;
const READ_ONLY_GIT_REMOTE = /^git\s+remote(\s+(-v|--verbose))?\s*$/;

export function needsApproval(mode: PermissionMode, toolName: string): boolean {
  if (CONTROL_TOOLS.has(toolName)) return true;
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
  /** Before/after file snapshot for write_file / edit_file approvals. */
  preview?: FileDiffPreview;
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
  /** Duplicate `ask` calls are folded into the first one covering the same
   * prompts: this points at its toolCallId and inherits its answers on
   * resolution. */
  mirrorOf?: string;
  /** Restored from disk after an app restart — the turn that raised it is
   * gone, so answering it cannot resume the original tool call. */
  restored?: boolean;
}

/** Disk persistence for unanswered `ask` cards (wired by `initInteractionPersistence`). */
type InteractionPersister = {
  list(): Promise<PersistedInteraction[]>;
  setAll(items: PersistedInteraction[]): Promise<void>;
};
export interface PersistedInteraction extends PendingInteractionInfo {
  sessionId: string;
}

let persister: InteractionPersister | null = null;

function persistPending(): void {
  if (!persister) return;
  const items: PersistedInteraction[] = [];
  for (const list of pending.values()) {
    for (const item of list) {
      // Only `ask` cards survive a restart — a restored permission prompt could
      // not run the tool it was gating, so it would just confuse.
      if (item.kind !== 'ask' || item.mirrorOf || item.answers !== undefined) continue;
      const { sessionId, toolCallId, name, args, kind, questions } = item;
      items.push({ sessionId, toolCallId, name, args, kind, questions });
    }
  }
  void persister.setAll(items).catch((err) => {
    console.warn('[chat] failed to persist pending interactions', err);
  });
}

export async function initInteractionPersistence(store: InteractionPersister): Promise<void> {
  persister = store;
  for (const item of await store.list()) {
    const list = pending.get(item.sessionId) ?? [];
    if (list.some((p) => p.toolCallId === item.toolCallId)) continue;
    list.push({ ...item, restored: true });
    pending.set(item.sessionId, list);
  }
}

/** Unresolved `ask` cards for a session — used to re-show the card after a restart. */
export function pendingAsksForSession(sessionId: string): PendingInteractionInfo[] {
  return (pending.get(sessionId) ?? [])
    .filter((item) => item.kind === 'ask' && !item.mirrorOf && item.answers === undefined)
    .map((item) => ({
      toolCallId: item.toolCallId,
      name: item.name,
      args: item.args,
      kind: item.kind,
      questions: item.questions,
    }));
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
/** Per-session map of normalized prompt → {question, answer}, for asks already
 * answered this turn. A model that re-asks the same question within the turn
 * gets the earlier answer back instantly instead of surfacing another card. */
type AnsweredQuestion = { question: AskQuestion; answer: string };
const answeredAskHistory = new Map<string, Map<string, AnsweredQuestion>>();
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
  answeredAskHistory.delete(sessionId);
  waiters.get(sessionId)?.resolve();
  waiters.delete(sessionId);
  persistPending();
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
  // Items can arrive already resolved (answer replayed from history).
  maybeResolveWaiter(item.sessionId);
}

function emitNextInteraction(sessionId: string): void {
  if (visibleInteraction.has(sessionId)) return;
  const next = (pending.get(sessionId) ?? []).find((item) => !isResolved(item) && !item.mirrorOf);
  if (!next) return;
  visibleInteraction.set(sessionId, next.toolCallId);
  const sink = sinks.get(sessionId);
  if (!sink) return;
  if (next.kind === 'ask') {
    console.info(`[chat] ask presented session=${sessionId} id=${next.toolCallId}`);
    sink({ type: 'ask', id: next.toolCallId, questions: next.questions ?? [] });
  } else {
    console.info(`[chat] permission presented session=${sessionId} id=${next.toolCallId} tool=${next.name}`);
    sink({
      type: 'permission',
      id: next.toolCallId,
      name: next.name,
      args: next.args,
      ...(next.preview ? { preview: next.preview } : {}),
    });
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
  preview?: FileDiffPreview;
}): Promise<boolean> {
  const { sessionId, toolCallId, name, args, mode, preview } = options;
  if (sessionAllow.get(sessionId)?.has(name)) return true;
  if (!needsApproval(mode, name)) return true;
  if (name === 'run_command' && typeof args.command === 'string' && isReadOnlyShellCommand(args.command)) {
    return true;
  }
  recordPending({ sessionId, toolCallId, name, args, kind: 'permission', preview });
  persistPending();
  return false;
}

/** Prompt text normalized for duplicate-ask detection — letters/digits only,
 * so whitespace, case and punctuation variants ("…气质？" vs "…气质！") key
 * identically and don't dilute bigram similarity. */
function promptKey(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Char-bigram Dice similarity between two normalized prompts. Catches the
 * "same question rephrased" re-asks models emit ("…整体气质…" vs "…想传达
 * 什么气质…") that exact matching misses. Length guard: bigram sets on tiny
 * strings are noise.
 */
function promptSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  const grams = (s: string) => {
    const g = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return (2 * hit) / (ga.size + gb.size);
}

/**
 * Would `answer` be a legitimate response to `q` as phrased now? Guards the
 * fuzzy fold so a rephrased ask only replays an answer that still makes sense:
 * direction picks must resolve to one of the new direction ids/titles, choice
 * answers must land inside the new option set. Free-text questions accept
 * anything.
 */
function answerFits(q: AskQuestion, answer: string): boolean {
  if (q.kind === 'direction') {
    if (!q.directions?.length) return true;
    return q.directions.some((d) => d.id === answer || d.title === answer);
  }
  const opts = q.options;
  if (!opts?.length) return true;
  // Multi-select answers arrive joined with ', '.
  return answer.split(/[,，]\s*/).every((p) => opts.includes(p));
}

/** Two questions are "the same" if prompts match exactly or are close rephrases
 * of the same (non-direction) kind. Direction asks fold only on exact prompts —
 * their answer space is the direction set, which rephrasing can't preserve. */
function promptsMatch(a: AskQuestion, b: AskQuestion): boolean {
  if (promptKey(a.prompt) === promptKey(b.prompt)) return true;
  if (a.kind === 'direction' || b.kind === 'direction') return false;
  return promptSimilarity(promptKey(a.prompt), promptKey(b.prompt)) >= 0.75;
}

/**
 * Look up a question's answer in this turn's history. Exact prompt matches
 * replay unconditionally (still via answerFits — the option set may have
 * changed under an identical prompt). Rephrased prompts replay only at a
 * decent match (≥0.35 when the new question's options can validate the answer,
 * ≥0.8 when free text gives nothing to check against) — or when the option
 * set itself is identical, which is a stronger same-question signal than
 * prompt wording.
 */
function sameOptionSet(a?: string[], b?: string[]): boolean {
  return !!a?.length && !!b?.length && a.length === b.length && a.every((o) => b.includes(o));
}

function lookupHistory(q: AskQuestion, history: Map<string, AnsweredQuestion>): string | undefined {
  const want = promptKey(q.prompt);
  const constrained =
    q.kind === 'direction' ? (q.directions?.length ?? 0) > 0 : (q.options?.length ?? 0) > 0;
  const minSim = constrained ? 0.35 : 0.8;
  let best: string | undefined;
  let bestSim = 0;
  for (const [k, h] of history) {
    const s = promptSimilarity(want, k);
    // An identical option set is a stronger signal than prompt wording — the
    // model's rephrase carries its choices with it (short CJK prompts like
    // "请选择封面气质" score ~0.25 on bigram Dice despite being the same ask).
    const sameChoices = q.kind !== 'direction' && sameOptionSet(q.options, h.question.options);
    if (s <= bestSim) continue;
    const accept =
      q.kind === 'direction'
        ? s >= minSim && answerFits(q, h.answer)
        : s === 1 || sameChoices || (s >= minSim && answerFits(q, h.answer));
    if (!accept) continue;
    bestSim = s;
    best = h.answer;
  }
  return best;
}

/** Map the source ask's answers onto the mirror's own question ids, matched by prompt. */
function translateAnswers(
  answers: Record<string, string>,
  sourceQuestions: AskQuestion[],
  mirrorQuestions: AskQuestion[],
): Record<string, string> {
  const translated: Record<string, string> = {};
  for (const q of mirrorQuestions) {
    const direct = answers[q.id];
    if (direct !== undefined) {
      translated[q.id] = direct;
      continue;
    }
    const source = sourceQuestions.find((s) => promptsMatch(s, q));
    if (source && answers[source.id] !== undefined) translated[q.id] = answers[source.id];
  }
  return translated;
}

/** Record a pending `ask` interaction. The caller then throws `ApprovalRequiredError`. */
export function registerPendingAsk(options: {
  sessionId: string;
  toolCallId: string;
  name: string;
  questions: AskQuestion[];
}): void {
  // Models occasionally emit the same ask_user call more than once — with
  // identical payloads or with the same questions repackaged (different
  // option sets, kinds, or order). Fold any call whose questions are all
  // already covered by a still-unanswered ask into that first one, so the
  // user never has to answer the same prompt twice.
  const unanswered = (pending.get(options.sessionId) ?? []).find((p) => {
    const qs = p.kind === 'ask' && p.answers === undefined ? p.questions : undefined;
    if (!qs || options.questions.length === 0) return false;
    return options.questions.every((q) => qs.some((s) => promptsMatch(s, q)));
  });

  // Already answered once this turn? Answer the re-ask from history without
  // surfacing a card at all — including rephrased re-asks whose recorded
  // answer is still a valid response to the new wording/options.
  const history = answeredAskHistory.get(options.sessionId);
  const fromHistory =
    !unanswered && history && options.questions.length > 0
      ? Object.fromEntries(
          options.questions.flatMap((q) => {
            const v = lookupHistory(q, history);
            return v === undefined ? [] : [[q.id, v]];
          }),
        )
      : undefined;
  if (fromHistory && Object.keys(fromHistory).length !== options.questions.length) {
    // Only fold when EVERY question resolves — a partial replay would strand
    // the model waiting on answers it never sees asked.
    recordPending({
      sessionId: options.sessionId,
      toolCallId: options.toolCallId,
      name: options.name,
      args: { questions: options.questions },
      kind: 'ask',
      questions: options.questions,
    });
    return;
  }

  // args carry the questions so the synthesized tool-result part persists
  // them — the renderer derives Q/A summary rows from part.args.questions.
  recordPending({
    sessionId: options.sessionId,
    toolCallId: options.toolCallId,
    name: options.name,
    args: { questions: options.questions },
    kind: 'ask',
    questions: options.questions,
    ...(unanswered ? { mirrorOf: unanswered.toolCallId } : {}),
    ...(fromHistory ? { answers: fromHistory } : {}),
  });
  persistPending();
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
    if (item.restored) {
      // The turn that asked is gone — nothing will consume the answer. Drop
      // the card; the renderer posts the answers as a normal user message.
      pending.set(sessionId, list.filter((p) => p !== item && p.mirrorOf !== toolCallId));
    } else {
      item.answers = answers;
      const history = answeredAskHistory.get(sessionId) ?? new Map<string, AnsweredQuestion>();
      for (const q of item.questions ?? []) {
        const v = answers[q.id];
        if (v !== undefined) history.set(promptKey(q.prompt), { question: q, answer: v });
      }
      answeredAskHistory.set(sessionId, history);
    }
    if (visibleInteraction.get(sessionId) === toolCallId) visibleInteraction.delete(sessionId);
    console.info(`[chat] ask answered session=${sessionId} id=${toolCallId}`);
    for (const dup of list) {
      if (dup.mirrorOf === toolCallId && dup.answers === undefined) {
        dup.answers = item.questions && dup.questions
          ? translateAnswers(answers, item.questions, dup.questions)
          : answers;
      }
    }
    emitNextInteraction(sessionId);
    maybeResolveWaiter(sessionId);
    persistPending();
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
  persistPending();
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
  answeredAskHistory.clear();
  waiters.clear();
}
