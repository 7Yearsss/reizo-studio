import * as api from '../api';
import type { ChatMessage, ReplyActivity, SessionSummary, ToolCallPart } from '../../shared/chat';
import type {
  AskQuestion,
  ChatStreamEvent,
  FileDiffPreview,
  MemoryEventRecord,
  ReplyPhase,
  TodoItem,
  TurnOutcome,
} from '../../shared/stream';
import type { StreamMeta } from '../api';
import { completeResync, createFence, ingestEnvelope, type Fence } from './liveRevisionFence';
import { createRevealController, type RevealController } from './revealController';
import * as settingsStore from './settingsStore';
import * as tabStore from './tabStore';
import * as uiStore from './uiStore';
import * as canvasStore from './canvasStore';
import { isCanvasTool, trailEntryFromTool, UNDOABLE_TRAIL_VERBS } from '../../shared/agentTrail';
import * as artifactStore from './artifactStore';
import { recordRecentSkill } from './skillStore';
import { appendTerminalLine } from './terminalStore';
import { notifyNeedsInput } from '../lib/notify';

export interface PendingPermission {
  id: string;
  name: string;
  args: Record<string, unknown>;
  preview?: FileDiffPreview;
}

export interface PendingAsk {
  id: string;
  questions: AskQuestion[];
}

/** Unified interaction model — permission gate or a mid-turn question. */
export type ChatInteraction =
  | { kind: 'permission'; id: string; name: string; args: Record<string, unknown>; preview?: FileDiffPreview }
  | { kind: 'ask'; id: string; questions: AskQuestion[] };

export interface QueuedTurn {
  id: string;
  text: string;
  mentions: string[];
  extra: { skillId?: string; attachments?: { name: string; content: string }[]; replaceFromId?: string };
}

export interface ComposerSeed {
  text: string;
  nonce: number;
  replaceFromId?: string;
}

export interface NodeRef {
  id: string;
  label: string;
  type?: string;
  thumbnail?: string;
  /** Normalized rect (0–1) the user marked on the node's image — a region reference. */
  region?: { x: number; y: number; w: number; h: number };
}

export interface ChatState {
  sessions: SessionSummary[];
  sessionsLoaded: boolean;
  messagesBySession: Record<string, ChatMessage[]>;
  streamingBySession: Record<string, string>;
  streamingReasoningBySession: Record<string, string>;
  /** Wall-clock ms when the first reasoning delta of the live turn arrived. */
  reasoningStartedAtBySession: Record<string, number | undefined>;
  /** Local send/resume clock for the live elapsed timer. Never a stale DB marker. */
  turnStartedAtBySession: Record<string, number | undefined>;
  lastProgressAtBySession: Record<string, number | undefined>;
  lastTextAtBySession: Record<string, number | undefined>;
  streamingToolsBySession: Record<string, ToolCallPart[]>;
  replyActivitiesBySession: Record<string, ReplyActivity[]>;
  replyPhaseBySession: Record<string, ReplyPhase | undefined>;
  turnOutcomeBySession: Record<string, TurnOutcome | null>;
  interruptRequestedBySession: Record<string, boolean>;
  sendingBySession: Record<string, boolean>;
  errorBySession: Record<string, string | null>;
  interactionBySession: Record<string, ChatInteraction | null>;
  todosBySession: Record<string, TodoItem[]>;
  /** Transient "this run may be stuck" notice from the tool-loop guard. */
  loopNoticeBySession: Record<string, string | null>;
  queueBySession: Record<string, QueuedTurn[]>;
  /** Steer messages accepted by the live turn's inbox, waiting for the
   * `user_message` event that confirms injection (renders the real bubble). */
  steerPendingBySession: Record<string, { id: string; text: string }[]>;
  composerSeedBySession: Record<string, ComposerSeed | undefined>;
  /** Skill pinned to a session — stays active across turns until unpinned. */
  skillBySession: Record<string, string | undefined>;
  /** Canvas nodes the user pulled into the composer as `@`-style references. */
  nodeRefsBySession: Record<string, NodeRef[]>;
  /** When true, clicking nodes on canvas adds them to the composer as references. */
  pickingReferenceBySession: Record<string, boolean>;
  /** Sessions where the user dismissed the "interrupted turn" banner. */
  interruptDismissedBySession: Record<string, boolean>;
  /** Memory activity (已记住/想起了 rows) shown inline in the timeline. */
  memoryEventsBySession: Record<string, MemoryEventRecord[]>;
  /** Turns that finished while the session wasn't on screen — drives the sidebar unread dot. */
  unreadBySession: Record<string, boolean>;
}

let state: ChatState = {
  sessions: [],
  sessionsLoaded: false,
  messagesBySession: {},
  streamingBySession: {},
  streamingReasoningBySession: {},
  reasoningStartedAtBySession: {},
  turnStartedAtBySession: {},
  lastProgressAtBySession: {},
  lastTextAtBySession: {},
  streamingToolsBySession: {},
  replyActivitiesBySession: {},
  replyPhaseBySession: {},
  turnOutcomeBySession: {},
  interruptRequestedBySession: {},
  sendingBySession: {},
  errorBySession: {},
  interactionBySession: {},
  todosBySession: {},
  loopNoticeBySession: {},
  queueBySession: {},
  steerPendingBySession: {},
  composerSeedBySession: {},
  skillBySession: {},
  nodeRefsBySession: {},
  pickingReferenceBySession: {},
  interruptDismissedBySession: {},
  memoryEventsBySession: {},
  unreadBySession: {},
};

function sameRef(a: NodeRef, b: NodeRef): boolean {
  return (
    a.id === b.id &&
    JSON.stringify(a.region ?? null) === JSON.stringify(b.region ?? null)
  );
}

export function addNodeRef(sessionId: string, ref: NodeRef): void {
  const current = state.nodeRefsBySession[sessionId] ?? [];
  if (current.some((r) => sameRef(r, ref))) return;
  setState({ nodeRefsBySession: { ...state.nodeRefsBySession, [sessionId]: [...current, ref] } });
}

export function removeNodeRef(
  sessionId: string,
  id: string,
  region?: NodeRef['region'],
): void {
  const current = state.nodeRefsBySession[sessionId] ?? [];
  setState({
    nodeRefsBySession: {
      ...state.nodeRefsBySession,
      [sessionId]: current.filter(
        (r) => !(r.id === id && JSON.stringify(r.region ?? null) === JSON.stringify(region ?? null)),
      ),
    },
  });
}

export function clearNodeRefs(sessionId: string): void {
  if (!(state.nodeRefsBySession[sessionId]?.length)) return;
  setState({ nodeRefsBySession: { ...state.nodeRefsBySession, [sessionId]: [] } });
}

export function setPickingReference(sessionId: string, active: boolean): void {
  if (state.pickingReferenceBySession[sessionId] === active) return;
  setState({
    pickingReferenceBySession: {
      ...state.pickingReferenceBySession,
      [sessionId]: active,
    },
  });
}

const abortBySession = new Map<string, AbortController>();
/** Watchdog-trip errors that mean the upstream stopped answering — worth an automatic retry. */
const UPSTREAM_STALL_ERRORS = new Set(['Upstream idle timeout', 'Turn stalled']);
/** Auto-retry budget per user turn — reset on each fresh (non-regenerate) send. */
const autoRetryBySession = new Map<string, number>();
const AUTO_RETRY_LIMIT = 2;
/** No stream events for this long (while idle — no tools running, not waiting on
 * the user) counts as a silent upstream: abort and retry instead of waiting
 * for the server's 5-minute watchdog. */
const STALL_DETECT_MS = 90_000;
const STALL_POLL_MS = 15_000;
/** Per-session turn counter — regenerated/retry dispatches reuse the current
 * value so "回滚本轮" covers the whole logical turn, not just the last pass. */
const turnSeqBySession = new Map<string, number>();

/** Non-reactive: liveRevision fence + last seen stream meta, per session. */
const fenceBySession = new Map<string, Fence>();
const streamMetaBySession = new Map<string, StreamMeta>();
const revealBySession = new Map<string, RevealController>();
const reasoningRevealBySession = new Map<string, RevealController>();
const listeners = new Set<() => void>();

function getReveal(sessionId: string): RevealController {
  let controller = revealBySession.get(sessionId);
  if (!controller) {
    controller = createRevealController((text) => {
      const now = Date.now();
      setState({
        streamingBySession: { ...state.streamingBySession, [sessionId]: text },
        lastTextAtBySession: { ...state.lastTextAtBySession, [sessionId]: now },
        lastProgressAtBySession: { ...state.lastProgressAtBySession, [sessionId]: now },
      });
    });
    revealBySession.set(sessionId, controller);
  }
  return controller;
}

function getReasoningReveal(sessionId: string): RevealController {
  let controller = reasoningRevealBySession.get(sessionId);
  if (!controller) {
    controller = createRevealController((text) => {
      setState({
        streamingReasoningBySession: { ...state.streamingReasoningBySession, [sessionId]: text },
        lastProgressAtBySession: { ...state.lastProgressAtBySession, [sessionId]: Date.now() },
      });
    });
    reasoningRevealBySession.set(sessionId, controller);
  }
  return controller;
}

function resetReveals(sessionId: string): void {
  revealBySession.get(sessionId)?.reset();
  reasoningRevealBySession.get(sessionId)?.reset();
}

function setState(patch: Partial<ChatState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function progressPatch(sessionId: string): Partial<ChatState> {
  return {
    lastProgressAtBySession: { ...state.lastProgressAtBySession, [sessionId]: Date.now() },
  };
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ChatState {
  return state;
}

/**
 * A finished turn counts as "seen" only while its session is the active chat
 * tab AND the window is focused — anything else earns an unread dot.
 * 'interrupted' outcomes don't count: the user stopped the turn themselves.
 */
function shouldMarkUnread(sessionId: string, outcome: TurnOutcome): boolean {
  if (outcome !== 'completed' && outcome !== 'error') return false;
  if (typeof document === 'undefined') return false;
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return true;
  if (uiStore.getSnapshot().mode !== 'chat') return true;
  return tabStore.activeSessionId() !== sessionId;
}

export function markSessionRead(sessionId: string): void {
  if (!state.unreadBySession[sessionId]) return;
  const { [sessionId]: _dropped, ...unreadBySession } = state.unreadBySession;
  setState({ unreadBySession });
}

export async function loadSessions(): Promise<void> {
  const sessions = await api.listSessions();
  const outcomes = Object.fromEntries(sessions.map((session) => [session.id, session.lastTurnOutcome ?? null]));
  const errors = Object.fromEntries(sessions.map((session) => [session.id, session.lastTurnError ?? null]));
  setState({
    sessions,
    sessionsLoaded: true,
    turnOutcomeBySession: { ...state.turnOutcomeBySession, ...outcomes },
    errorBySession: { ...state.errorBySession, ...errors },
  });
  tabStore.pruneMissingSessions(sessions.map((s) => s.id));
}

export async function createSession(title?: string, projectId?: string | null): Promise<SessionSummary> {
  const workspacePath = settingsStore.getSnapshot().settings.workspacePath;
  const resolvedProjectId = projectId === undefined ? uiStore.getSnapshot().selectedProjectId : projectId;
  const session = await api.createSession(title, workspacePath, resolvedProjectId);
  setState({
    sessions: [
      {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        workspacePath: session.workspacePath,
        projectId: session.projectId,
      },
      ...state.sessions,
    ],
    messagesBySession: { ...state.messagesBySession, [session.id]: session.messages },
    turnOutcomeBySession: { ...state.turnOutcomeBySession, [session.id]: session.lastTurnOutcome ?? null },
  });
  return session;
}

export async function assignSessionProject(id: string, projectId: string | null): Promise<void> {
  const session = await api.patchSession(id, { projectId });
  setState({
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, projectId: session.projectId } : s)),
  });
}

export async function renameSession(id: string, title: string): Promise<void> {
  await api.renameSession(id, title);
  setState({
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
  });
  tabStore.renameChatTab(id, title);
}

export async function deleteSession(id: string): Promise<void> {
  await api.deleteSession(id);
  const { [id]: _removedMessages, ...messagesBySession } = state.messagesBySession;
  const { [id]: _removedStreaming, ...streamingBySession } = state.streamingBySession;
  const { [id]: _removedTools, ...streamingToolsBySession } = state.streamingToolsBySession;
  const { [id]: _removedReasoning, ...streamingReasoningBySession } = state.streamingReasoningBySession;
  const { [id]: _removedReasoningAt, ...reasoningStartedAtBySession } = state.reasoningStartedAtBySession;
  const { [id]: _removedTurnAt, ...turnStartedAtBySession } = state.turnStartedAtBySession;
  const { [id]: _removedProgressAt, ...lastProgressAtBySession } = state.lastProgressAtBySession;
  const { [id]: _removedTextAt, ...lastTextAtBySession } = state.lastTextAtBySession;
  const { [id]: _removedActivities, ...replyActivitiesBySession } = state.replyActivitiesBySession;
  const { [id]: _removedPhase, ...replyPhaseBySession } = state.replyPhaseBySession;
  const { [id]: _removedOutcome, ...turnOutcomeBySession } = state.turnOutcomeBySession;
  const { [id]: _removedInterrupt, ...interruptRequestedBySession } = state.interruptRequestedBySession;
  const { [id]: _removedSteers, ...steerPendingBySession } = state.steerPendingBySession;
  const { [id]: _removedUnread, ...unreadBySession } = state.unreadBySession;
  fenceBySession.delete(id);
  streamMetaBySession.delete(id);
  resetReveals(id);
  revealBySession.delete(id);
  reasoningRevealBySession.delete(id);
  setState({
    sessions: state.sessions.filter((s) => s.id !== id),
    messagesBySession,
    streamingBySession,
    streamingToolsBySession,
    streamingReasoningBySession,
    reasoningStartedAtBySession,
    turnStartedAtBySession,
    lastProgressAtBySession,
    lastTextAtBySession,
    replyActivitiesBySession,
    replyPhaseBySession,
    turnOutcomeBySession,
    interruptRequestedBySession,
    steerPendingBySession,
    unreadBySession,
  });
  tabStore.closeSessionTabs(id);
  artifactStore.dropSessionArtifacts(id);
}

function isInterrupted(summary: SessionSummary | undefined): boolean {
  if (!summary?.activeTurnStartedAt) return false;
  const started = Date.parse(summary.activeTurnStartedAt);
  const ended = summary.lastTurnEndedAt ? Date.parse(summary.lastTurnEndedAt) : 0;
  return started > ended;
}

function hasInterruptedOutcome(summary: SessionSummary | undefined): boolean {
  return summary?.lastTurnOutcome === 'interrupted' || isInterrupted(summary);
}

/** Whether the "上次回复被中断" banner should show for this session. */
export function shouldShowInterruptBanner(sessionId: string): boolean {
  return (
    hasInterruptedOutcome(state.sessions.find((s) => s.id === sessionId)) &&
    !state.sendingBySession[sessionId] &&
    !state.interruptDismissedBySession[sessionId]
  );
}

export function dismissInterrupt(sessionId: string): void {
  setState({
    interruptDismissedBySession: { ...state.interruptDismissedBySession, [sessionId]: true },
  });
}

export async function ensureSessionMessages(
  id: string,
  opts: { resume?: boolean } = {},
): Promise<void> {
  const session = await api.getSession(id);
  if (state.sendingBySession[id]) {
    setState({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...summaryOf(session) } : s)),
    });
    return;
  }
  setState({
    messagesBySession: { ...state.messagesBySession, [id]: session.messages },
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...summaryOf(session) } : s)),
    turnOutcomeBySession: { ...state.turnOutcomeBySession, [id]: session.lastTurnOutcome ?? null },
    errorBySession: { ...state.errorBySession, [id]: session.lastTurnError ?? null },
  });
  void api
    .fetchMemoryEvents(id)
    .then((events): void => {
      setState({
        memoryEventsBySession: { ...state.memoryEventsBySession, [id]: events },
      });
    })
    .catch((): void => undefined);
  // A turn was in flight when we last lost the connection — try to reattach.
  // Hidden tabs must not hold a resume stream: a turn suspended on an ask card
  // keeps its socket open indefinitely, and N mounted tabs exhaust the pool.
  // The effect re-runs on activation, so the stream attaches when the tab shows.
  if (opts.resume !== false && isInterrupted(summaryOf(session)) && !state.sendingBySession[id]) {
    void resumeInterruptedTurn(id);
  }
  // Ask cards persist across restarts — re-show any unanswered one (e.g. the
  // app was killed while a question card was on screen).
  restorePendingAsk(id);
}

/** Re-show an unanswered ask card from the server (hydrate, reconnect, stream end). */
function restorePendingAsk(id: string): void {
  if (state.interactionBySession[id]) return;
  void api.getPendingInteractions(id).then((interactions): void => {
    const ask = interactions.find((i) => i.kind === 'ask' && i.questions?.length);
    if (!ask || state.interactionBySession[id]) return;
    setState({
      interactionBySession: {
        ...state.interactionBySession,
        [id]: { kind: 'ask', id: ask.toolCallId, questions: ask.questions ?? [] },
      },
    });
    notifyNeedsInput('Reizo 在等你回答', (ask.questions?.[0]?.prompt ?? 'Agent 需要你的输入').slice(0, 80));
  }).catch(() => {
    /* session may not exist yet — ignore */
  });
}

function summaryOf(session: {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspacePath?: string | null;
  projectId?: string | null;
  activeTurnStartedAt?: string | null;
  lastTurnEndedAt?: string | null;
  lastTurnOutcome?: TurnOutcome | null;
  lastTurnError?: string | null;
}): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    workspacePath: session.workspacePath,
    projectId: session.projectId,
    activeTurnStartedAt: session.activeTurnStartedAt,
    lastTurnEndedAt: session.lastTurnEndedAt,
    lastTurnOutcome: session.lastTurnOutcome,
    lastTurnError: session.lastTurnError,
  };
}

export function seedComposer(
  sessionId: string,
  text: string,
  extra: { replaceFromId?: string } = {},
): void {
  const prev = state.composerSeedBySession[sessionId];
  setState({
    composerSeedBySession: {
      ...state.composerSeedBySession,
      [sessionId]: {
        text,
        nonce: (prev?.nonce ?? 0) + 1,
        replaceFromId: extra.replaceFromId,
      },
    },
  });
}

export function setSessionSkill(sessionId: string, skillId?: string): void {
  setState({ skillBySession: { ...state.skillBySession, [sessionId]: skillId } });
}

export function clearComposerSeed(sessionId: string): void {
  if (!state.composerSeedBySession[sessionId]) return;
  const { [sessionId]: _removed, ...composerSeedBySession } = state.composerSeedBySession;
  setState({ composerSeedBySession });
}

export async function sendMessage(
  sessionId: string,
  text: string,
  mentions: string[] = [],
  extra: {
    skillId?: string;
    attachments?: { name: string; content: string }[];
    replaceFromId?: string;
  } = {},
): Promise<void> {
  if (state.sendingBySession[sessionId]) {
    const queued: QueuedTurn = { id: `q-${Date.now()}`, text, mentions, extra };
    setState({
      queueBySession: {
        ...state.queueBySession,
        [sessionId]: [...(state.queueBySession[sessionId] ?? []), queued],
      },
    });
    return;
  }
  await dispatchTurn(sessionId, text, mentions, extra, {
    truncateAfterId: extra.replaceFromId,
  });
}

export function removeQueuedTurn(sessionId: string, id: string): void {
  setState({
    queueBySession: {
      ...state.queueBySession,
      [sessionId]: (state.queueBySession[sessionId] ?? []).filter((item) => item.id !== id),
    },
  });
}

/** Interrupt the live turn (if any) and send immediately — Cursor's "Send now". */
export async function sendNow(
  sessionId: string,
  text: string,
  mentions: string[] = [],
  extra: QueuedTurn['extra'] = {},
): Promise<void> {
  if (!text.trim()) return;
  if (state.sendingBySession[sessionId]) await stopMessage(sessionId);
  await dispatchTurn(sessionId, text, mentions, extra, {
    truncateAfterId: extra.replaceFromId,
  });
}

/** Pull a queued item out of the queue and send it right away, interrupting the live turn first. */
export async function sendQueuedNow(sessionId: string, id: string): Promise<void> {
  const item = (state.queueBySession[sessionId] ?? []).find((q) => q.id === id);
  if (!item) return;
  removeQueuedTurn(sessionId, id);
  await sendNow(sessionId, item.text, item.mentions, item.extra);
}

/** Pop every queued turn so the composer can put their text back for editing (Claude Code's ↑ recall). */
export function recallQueue(sessionId: string): QueuedTurn[] {
  const items = state.queueBySession[sessionId] ?? [];
  if (items.length === 0) return [];
  setState({ queueBySession: { ...state.queueBySession, [sessionId]: [] } });
  return items;
}

/**
 * Steer (插话): send a message into the LIVE turn — the server parks it in the
 * turn's inbox and injects it at the next step boundary, no interrupt, no new
 * turn. Shows as a pending row until the `user_message` event confirms the
 * injection; falls back to the queue when no turn is live or the steer
 * carries things only a normal turn supports (attachments, replace/regenerate).
 */
export async function steerNow(
  sessionId: string,
  text: string,
  mentions: string[] = [],
  extra: QueuedTurn['extra'] = {},
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (!state.sendingBySession[sessionId] || extra.attachments?.length || extra.replaceFromId) {
    await sendMessage(sessionId, text, mentions, extra);
    return;
  }
  const id = `steer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pending = { id, text: trimmed };
  setState({
    steerPendingBySession: {
      ...state.steerPendingBySession,
      [sessionId]: [...(state.steerPendingBySession[sessionId] ?? []), pending],
    },
  });
  try {
    const res = await api.steerTurn(sessionId, { id, text: trimmed, mentions });
    if (!res.accepted) throw new Error('no live turn');
  } catch {
    setState({
      steerPendingBySession: {
        ...state.steerPendingBySession,
        [sessionId]: (state.steerPendingBySession[sessionId] ?? []).filter((p) => p.id !== id),
      },
    });
    await sendMessage(sessionId, text, mentions, extra);
  }
}

/** Steer every queued message into the live turn at once (empty-draft Ctrl+Enter). */
export async function steerAllQueued(sessionId: string): Promise<void> {
  const items = state.queueBySession[sessionId] ?? [];
  if (items.length === 0) return;
  setState({ queueBySession: { ...state.queueBySession, [sessionId]: [] } });
  for (const item of items) {
    await steerNow(sessionId, item.text, item.mentions, item.extra);
  }
}

/**
 * Turn over: park any steer the server accepted but never injected back into
 * the queue (send order preserved — leftovers append behind older queued
 * items). Anything still in `steerPending` but absent from the server drain
 * was never accepted (the fallback already queued it), so only the drain is
 * authoritative for what to re-enqueue.
 */
async function settleSteerInbox(sessionId: string): Promise<void> {
  let leftovers: { id: string; content: string }[] = [];
  try {
    leftovers = (await api.drainSteers(sessionId)).items;
  } catch {
    /* local API unreachable — pending steers just drop */
  }
  const pending = state.steerPendingBySession[sessionId] ?? [];
  const leftoverById = new Map(leftovers.map((i) => [i.id, i.content]));
  // Union of client-pending (POST accepted but pending until injected) and
  // server-leftover (covers a renderer reload, where steerPending is empty
  // but the server inbox still holds items).
  const pendingIds = new Set(pending.map((p) => p.id));
  const requeue = [
    ...pending.map((p) => leftoverById.get(p.id) ?? p.text),
    ...leftovers.filter((i) => !pendingIds.has(i.id)).map((i) => i.content),
  ];
  if (pending.length > 0 || leftovers.length > 0) {
    setState({
      steerPendingBySession: { ...state.steerPendingBySession, [sessionId]: [] },
      ...(requeue.length > 0
        ? {
            queueBySession: {
              ...state.queueBySession,
              [sessionId]: [
                ...(state.queueBySession[sessionId] ?? []),
                ...requeue.map((text, i) => ({
                  id: `q-steer-${Date.now()}-${i}`,
                  text,
                  mentions: [] as string[],
                  extra: {},
                })),
              ],
            },
          }
        : {}),
    });
  }
}

export async function continueQueue(sessionId: string): Promise<void> {
  const next = (state.queueBySession[sessionId] ?? [])[0];
  if (!next || state.sendingBySession[sessionId]) return;
  setState({
    queueBySession: {
      ...state.queueBySession,
      [sessionId]: (state.queueBySession[sessionId] ?? []).slice(1),
    },
  });
  await dispatchTurn(sessionId, next.text, next.mentions, next.extra, {
    truncateAfterId: next.extra.replaceFromId,
  });
}

export async function retryLastAssistant(sessionId: string): Promise<void> {
  if (state.sendingBySession[sessionId]) return;
  const messages = state.messagesBySession[sessionId] ?? [];
  let lastAssistant: ChatMessage | undefined;
  let lastUser: ChatMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!lastAssistant && msg.role === 'assistant') lastAssistant = msg;
    if (!lastUser && msg.role === 'user') lastUser = msg;
    if (lastAssistant && lastUser) break;
  }
  if (!lastAssistant || !lastUser) return;
  const cut = messages.findIndex((m) => m.id === lastAssistant.id);
  if (cut < 0) return;
  await dispatchTurn(sessionId, lastUser.content, [], {}, {
    truncateAfterId: lastAssistant.id,
    regenerate: true,
    optimisticMessages: messages.slice(0, cut),
  });
}

/** "继续" on the interrupted-turn banner: re-run the last user message. */
export async function retryInterruptedTurn(sessionId: string): Promise<void> {
  if (state.sendingBySession[sessionId]) return;
  const messages = state.messagesBySession[sessionId] ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return;
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  // Drop a stale assistant reply that landed after the interrupted user turn.
  const cutId =
    lastAssistant && messages.indexOf(lastAssistant) > messages.indexOf(lastUser)
      ? lastAssistant.id
      : undefined;
  dismissInterrupt(sessionId);
  await dispatchTurn(sessionId, lastUser.content, [], {}, {
    truncateAfterId: cutId,
    regenerate: true,
    optimisticMessages: cutId ? messages.slice(0, messages.findIndex((m) => m.id === cutId)) : messages,
  });
}

/** "重试" on the stalled-reply status row: kill the live turn and re-run the
 * last user message immediately instead of waiting out the watchdog. */
export async function retryStalledTurn(sessionId: string): Promise<void> {
  if (!state.sendingBySession[sessionId]) {
    await retryInterruptedTurn(sessionId);
    return;
  }
  try {
    await api.stopMessage(sessionId);
  } catch {
    /* still release below */
  }
  abortBySession.get(sessionId)?.abort();
  // Wait for the in-flight dispatch's cleanup to release the session.
  for (let i = 0; i < 50 && getSnapshot().sendingBySession[sessionId]; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await retryInterruptedTurn(sessionId);
}

export function editLastUserMessage(sessionId: string): void {
  if (state.sendingBySession[sessionId]) return;
  const messages = state.messagesBySession[sessionId] ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return;
  seedComposer(sessionId, lastUser.content, { replaceFromId: lastUser.id });
}

function notifyIfHidden(title: string): void {
  if (typeof document === 'undefined' || !document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('Reizo', { body: title });
  } catch {
    /* ignore */
  }
}

/**
 * Fold one stream event into per-session state. Shared by a fresh turn and a
 * resume. Envelope metadata drives the liveRevision fence so a gap/epoch
 * change triggers a resync rather than a silent desync.
 */
function upsertThinkingActivity(acc: { activities: ReplyActivity[] }, delta?: string): ReplyActivity {
  const index = acc.activities.findLastIndex((activity) => activity.kind === 'thinking' && activity.status === 'running');
  const current = index >= 0 ? acc.activities[index] : undefined;
  const thinkingCount = acc.activities.filter((activity) => activity.kind === 'thinking').length;
  const next: ReplyActivity = {
    id: current?.id ?? `thinking-${thinkingCount + 1}`,
    kind: 'thinking',
    status: 'running',
    text: `${current?.text ?? ''}${delta ?? ''}`,
    startedAt: current?.status === 'running' ? current.startedAt : Date.now(),
    durationMs: current?.status === 'running' ? current.durationMs : undefined,
  };
  if (index >= 0) acc.activities[index] = next;
  else acc.activities.push(next);
  return next;
}

function upsertToolPart(acc: { tools: ToolCallPart[] }, event: Extract<ChatStreamEvent, { type: 'tool' }>): ToolCallPart {
  const index = acc.tools.findIndex((part) => part.id === event.id);
  const current = index >= 0 ? acc.tools[index] : undefined;
  const next: ToolCallPart = {
    type: 'tool',
    id: event.id,
    name: event.name || current?.name || 'tool',
    args: Object.keys(event.args).length > 0 ? event.args : (current?.args ?? {}),
    result: event.result ?? current?.result,
    error: event.error ?? current?.error,
  };
  if (index >= 0) acc.tools[index] = next;
  else acc.tools.push(next);
  return next;
}

function upsertToolActivity(
  acc: { activities: ReplyActivity[] },
  part: ToolCallPart,
): ReplyActivity {
  const index = acc.activities.findIndex((activity) => activity.kind === 'tool' && activity.id === part.id);
  const current = index >= 0 ? acc.activities[index] : undefined;
  const finished = part.error !== undefined || part.result !== undefined;
  const next: ReplyActivity = {
    id: part.id,
    kind: 'tool',
    status: part.error !== undefined ? 'error' : finished ? 'done' : 'running',
    startedAt: current?.startedAt ?? Date.now(),
    durationMs: finished
      ? current?.startedAt
        ? Math.max(0, Date.now() - current.startedAt)
        : current?.durationMs
      : undefined,
    tool: part,
  };
  if (index >= 0) acc.activities[index] = next;
  else acc.activities.push(next);
  return next;
}

function finishThinkingActivity(acc: { activities: ReplyActivity[] }): void {
  const index = acc.activities.findLastIndex((activity) => activity.kind === 'thinking' && activity.status === 'running');
  if (index < 0) return;
  const current = acc.activities[index];
  acc.activities[index] = {
    ...current,
    status: 'done',
    durationMs: current.startedAt ? Math.max(0, Date.now() - current.startedAt) : current.durationMs,
  };
}

function makeEventFolder(
  sessionId: string,
  acc: { text: string; reasoning: string; tools: ToolCallPart[]; activities: ReplyActivity[]; breakPending?: boolean },
) {
  return (event: ChatStreamEvent, meta?: StreamMeta): void => {
    if (meta) {
      const fence = fenceBySession.get(sessionId) ?? createFence(sessionId);
      const { fence: nextFence, action } = ingestEnvelope(fence, {
        v: 1,
        sessionId,
        rev: meta.rev,
        epoch: meta.epoch,
        event,
      });
      fenceBySession.set(sessionId, nextFence);
      streamMetaBySession.set(sessionId, meta);
      if (action === 'drop') return;
      if (action === 'resync') {
        // Post-stream getSession reconcile is unconditional, so folding this
        // event and letting the tail resync is safe; just advance the fence.
        fenceBySession.set(sessionId, completeResync(nextFence, meta.rev, meta.epoch));
      }
    }

    switch (event.type) {
      case 'text': {
        // New prose after a finished tool call starts a new paragraph — the
        // alternative is every pass's reply concatenating into one wall.
        if (acc.breakPending && acc.text.length > 0 && !acc.text.endsWith('\n\n')) acc.text += '\n\n';
        acc.breakPending = false;
        acc.text += event.delta;
        const thinkingRunning = acc.activities.some((activity) => activity.kind === 'thinking' && activity.status === 'running');
        finishThinkingActivity(acc);
        getReveal(sessionId).push(acc.text);
        if (thinkingRunning || state.replyPhaseBySession[sessionId] !== 'replying') {
          setState({
            replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
            replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: 'replying' },
          });
        }
        break;
      }
      case 'reasoning': {
        const first = acc.reasoning.length === 0;
        acc.reasoning += event.delta;
        upsertThinkingActivity(acc, event.delta);
        getReasoningReveal(sessionId).push(acc.reasoning);
        if (first || state.replyPhaseBySession[sessionId] !== 'thinking') {
          setState({
            ...(first
              ? {
                  reasoningStartedAtBySession: {
                    ...state.reasoningStartedAtBySession,
                    [sessionId]: Date.now(),
                  },
                }
              : {}),
            replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
            replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: 'thinking' },
          });
        }
        break;
      }
      case 'tool': {
        finishThinkingActivity(acc);
        const part = upsertToolPart(acc, event);
        upsertToolActivity(acc, part);
        if (part.result !== undefined || part.error !== undefined) acc.breakPending = true;
        // The agent touched the canvas — open panel, record a trail entry, spotlight the
        // affected nodes, and (P0-2) batch structural writes into the undo stack.
        {
          if (
            event.name === 'open_canvas' ||
            (isCanvasTool(event.name) && event.name !== 'read_canvas' && event.name !== 'read_node')
          ) {
            uiStore.setRightPanelTab('canvas');
          }
          const trail = trailEntryFromTool(event);
          if (trail) {
            canvasStore.pushTrail(sessionId, trail);
            if (trail.nodeIds.length > 0) canvasStore.spotlight(sessionId, trail.nodeIds);
            if (trail.status === 'done' && UNDOABLE_TRAIL_VERBS.has(trail.verb)) {
              canvasStore.recordAgentBatch(sessionId, trail, turnSeqBySession.get(sessionId));
              if (trail.nodeIds.length > 0) {
                canvasStore.queueAgentNodesToast(sessionId, trail.nodeIds.length);
              }
            }
          }
        }
        setState({
          ...progressPatch(sessionId),
          streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [...acc.tools] },
          replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
          replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: 'tools' },
        });
        if (event.name === 'run_command' && event.result) {
          try {
            const parsed = JSON.parse(event.result) as {
              command?: string;
              stdout?: string;
              stderr?: string;
              exitCode?: number;
            };
            appendTerminalLine({
              command: parsed.command ?? String(event.args.command ?? ''),
              stdout: parsed.stdout ?? '',
              stderr: parsed.stderr ?? '',
              exitCode: parsed.exitCode ?? 0,
            });
          } catch {
            /* ignore */
          }
        }
        break;
      }
      case 'permission':
        setState({
          ...progressPatch(sessionId),
          interactionBySession: {
            ...state.interactionBySession,
            [sessionId]: {
              kind: 'permission',
              id: event.id,
              name: event.name,
              args: event.args,
              ...(event.preview ? { preview: event.preview } : {}),
            },
          },
        });
        notifyNeedsInput('Reizo 需要你批准', `操作：${event.name}`);
        break;
      case 'ask':
        setState({
          ...progressPatch(sessionId),
          interactionBySession: {
            ...state.interactionBySession,
            [sessionId]: { kind: 'ask', id: event.id, questions: event.questions },
          },
        });
        notifyNeedsInput(
          'Reizo 在等你回答',
          (event.questions?.[0]?.prompt ?? 'Agent 需要你的输入').slice(0, 80),
        );
        break;
      case 'todos':
        setState({ todosBySession: { ...state.todosBySession, [sessionId]: event.items } });
        break;
      case 'tool_loop':
        setState({
          loopNoticeBySession: {
            ...state.loopNoticeBySession,
            [sessionId]: event.tier === 'halt' ? `已停止：${event.reason}` : `这一轮可能卡住了：${event.reason}`,
          },
        });
        break;
      case 'error':
        setState({
          errorBySession: { ...state.errorBySession, [sessionId]: event.error },
          turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: 'error' },
        });
        break;
      case 'status':
        if (event.heartbeat) break;
        if (event.phase === 'thinking') upsertThinkingActivity(acc);
        if (event.phase === 'tools' || event.phase === 'replying' || event.phase === 'waiting') finishThinkingActivity(acc);
        setState({
          ...progressPatch(sessionId),
          replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
          replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: event.phase },
        });
        break;
      case 'user_message':
        // A steer was injected mid-turn — render the real user bubble and
        // clear its pending row. Dedupe guards against reconnect replays.
        setState({
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: (state.messagesBySession[sessionId] ?? []).some(
              (m) => m.id === event.id,
            )
              ? state.messagesBySession[sessionId] ?? []
              : [
                  ...(state.messagesBySession[sessionId] ?? []),
                  {
                    id: event.id,
                    role: 'user' as const,
                    content: event.content,
                    createdAt: event.createdAt,
                  },
                ],
          },
          steerPendingBySession: {
            ...state.steerPendingBySession,
            [sessionId]: (state.steerPendingBySession[sessionId] ?? []).filter(
              (p) => p.id !== event.id,
            ),
          },
        });
        break;
      case 'memory':
        setState({
          memoryEventsBySession: {
            ...state.memoryEventsBySession,
            [sessionId]: [
              ...(state.memoryEventsBySession[sessionId] ?? []),
              {
                id: `me_${Date.now().toString(36)}`,
                createdAt: new Date().toISOString(),
                action: event.action,
                items: event.items,
              },
            ],
          },
        });
        break;
      case 'done':
        getReveal(sessionId).flush();
        getReasoningReveal(sessionId).flush();
        finishThinkingActivity(acc);
        setState({
          replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
          turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: event.outcome },
          interruptRequestedBySession: { ...state.interruptRequestedBySession, [sessionId]: false },
          ...(event.error ? { errorBySession: { ...state.errorBySession, [sessionId]: event.error } } : {}),
          // A turn that lands while the session isn't on screen gets an
          // unread dot in the sidebar; cleared when the user opens it.
          ...(shouldMarkUnread(sessionId, event.outcome)
            ? { unreadBySession: { ...state.unreadBySession, [sessionId]: true } }
            : {}),
        });
        break;
    }
  };
}

async function reconcileAfterTurn(sessionId: string, fallbackOutcome?: TurnOutcome): Promise<void> {
  resetReveals(sessionId);
  const session = await api.getSession(sessionId);
  setState({
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...summaryOf(session) } : s)),
    messagesBySession: { ...state.messagesBySession, [sessionId]: session.messages },
    streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
    streamingReasoningBySession: { ...state.streamingReasoningBySession, [sessionId]: '' },
    reasoningStartedAtBySession: { ...state.reasoningStartedAtBySession, [sessionId]: undefined },
    turnStartedAtBySession: { ...state.turnStartedAtBySession, [sessionId]: undefined },
    lastProgressAtBySession: { ...state.lastProgressAtBySession, [sessionId]: undefined },
    lastTextAtBySession: { ...state.lastTextAtBySession, [sessionId]: undefined },
    streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
    replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
    replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
    interactionBySession: { ...state.interactionBySession, [sessionId]: null },
    turnOutcomeBySession: {
      ...state.turnOutcomeBySession,
      [sessionId]: session.lastTurnOutcome ?? fallbackOutcome ?? null,
    },
    errorBySession: {
      ...state.errorBySession,
      [sessionId]: session.lastTurnError ?? state.errorBySession[sessionId] ?? null,
    },
    interruptRequestedBySession: { ...state.interruptRequestedBySession, [sessionId]: false },
  });
  // The stream may have ended while the turn is suspended awaiting an answer
  // (reload, dropped connection) — don't leave the user staring at a spinner:
  // re-fetch any still-unanswered ask and re-show its card.
  restorePendingAsk(sessionId);
  tabStore.renameChatTab(sessionId, session.title);
  void artifactStore.loadSessionArtifacts(sessionId);
  notifyIfHidden(session.title);
}

async function dispatchTurn(
  sessionId: string,
  text: string,
  mentions: string[] = [],
  extra: { skillId?: string; attachments?: { name: string; content: string }[] } = {},
  turn: {
    truncateAfterId?: string;
    regenerate?: boolean;
    optimisticMessages?: ChatMessage[];
  } = {},
): Promise<void> {
  const existing = turn.optimisticMessages ?? (() => {
    const current = state.messagesBySession[sessionId] ?? [];
    if (!turn.truncateAfterId) return current;
    const idx = current.findIndex((m) => m.id === turn.truncateAfterId);
    return idx < 0 ? current : current.slice(0, idx);
  })();
  if (!turn.regenerate) {
    autoRetryBySession.delete(sessionId);
    turnSeqBySession.set(sessionId, (turnSeqBySession.get(sessionId) ?? 0) + 1);
  }
  const userMessage: ChatMessage | null = turn.regenerate
    ? null
    : {
        id: `local-${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
  const nextMessages = userMessage ? [...existing, userMessage] : existing;
  // An explicit skillId pins/records it; otherwise fall back to the session pin
  // so queued and programmatic sends run under the same skill.
  const effectiveSkillId = extra.skillId ?? state.skillBySession[sessionId];
  const abort = new AbortController();
  abortBySession.set(sessionId, abort);
  fenceBySession.set(sessionId, createFence(sessionId));
  streamMetaBySession.delete(sessionId);
  resetReveals(sessionId);

  setState({
    messagesBySession: { ...state.messagesBySession, [sessionId]: nextMessages },
    sendingBySession: { ...state.sendingBySession, [sessionId]: true },
    streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
    streamingReasoningBySession: { ...state.streamingReasoningBySession, [sessionId]: '' },
    reasoningStartedAtBySession: { ...state.reasoningStartedAtBySession, [sessionId]: undefined },
    turnStartedAtBySession: { ...state.turnStartedAtBySession, [sessionId]: Date.now() },
    lastProgressAtBySession: { ...state.lastProgressAtBySession, [sessionId]: Date.now() },
    lastTextAtBySession: { ...state.lastTextAtBySession, [sessionId]: undefined },
    streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
    replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
    replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: 'thinking' },
    turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: null },
    interruptRequestedBySession: { ...state.interruptRequestedBySession, [sessionId]: false },
    errorBySession: { ...state.errorBySession, [sessionId]: null },
    loopNoticeBySession: { ...state.loopNoticeBySession, [sessionId]: null },
    interactionBySession: { ...state.interactionBySession, [sessionId]: null },
    interruptDismissedBySession: { ...state.interruptDismissedBySession, [sessionId]: false },
    // An explicit skillId pins the skill to the session; omitting it leaves
    // any existing pin in place (the composer's pinned chip keeps sending it).
    ...(effectiveSkillId
      ? { skillBySession: { ...state.skillBySession, [sessionId]: effectiveSkillId } }
      : {}),
  });
  if (effectiveSkillId) recordRecentSkill(effectiveSkillId);
  clearComposerSeed(sessionId);

  const settings = settingsStore.getSnapshot().settings;
  const acc = { text: '', reasoning: '', tools: [] as ToolCallPart[], activities: [] as ReplyActivity[] };
  let reconnectAfterTransportLoss = false;

  // Proactive stall detection: the server watchdog gives up after 5 idle
  // minutes, which feels like a hang. If the stream goes quiet while nothing
  // is legitimately running (no in-flight tool, not parked on an ask card),
  // abort and re-dispatch the turn ourselves — capped by autoRetryBySession.
  const stallPoll = window.setInterval(() => {
    const snap = getSnapshot();
    if (!snap.sendingBySession[sessionId]) return;
    if (snap.interactionBySession[sessionId]) return;
    if ((snap.streamingToolsBySession[sessionId] ?? []).some((p) => p.result === undefined && p.error === undefined)) return;
    const lastProgress = snap.lastProgressAtBySession[sessionId];
    if (!lastProgress || Date.now() - lastProgress < STALL_DETECT_MS) return;
    if ((autoRetryBySession.get(sessionId) ?? 0) >= AUTO_RETRY_LIMIT) return;
    autoRetryBySession.set(sessionId, (autoRetryBySession.get(sessionId) ?? 0) + 1);
    void retryStalledTurn(sessionId);
  }, STALL_POLL_MS);

  try {
    await api.sendMessage(sessionId, text, {
      providerId: settings.activeProviderId,
      model: settings.providers.find((p) => p.id === settings.activeProviderId)?.model,
      mentions,
      skillId: effectiveSkillId,
      attachments: extra.attachments,
      truncateAfterId: turn.truncateAfterId,
      regenerate: turn.regenerate,
      signal: abort.signal,
      onEvent: makeEventFolder(sessionId, acc),
    });
    await reconcileAfterTurn(sessionId, state.turnOutcomeBySession[sessionId] ?? undefined);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      setState({ turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: 'interrupted' } });
      return;
    }
    if (isIncompleteStream(err)) {
      reconnectAfterTransportLoss = true;
      setState({
        errorBySession: { ...state.errorBySession, [sessionId]: '回复连接中断，正在恢复…' },
      });
      return;
    }
    resetReveals(sessionId);
    try {
      const session = await api.getSession(sessionId);
      setState({
        messagesBySession: { ...state.messagesBySession, [sessionId]: session.messages },
        streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
        replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
        replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
        errorBySession: { ...state.errorBySession, [sessionId]: (err as Error).message },
        turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: 'error' },
      });
    } catch {
      setState({ errorBySession: { ...state.errorBySession, [sessionId]: (err as Error).message } });
    }
  } finally {
    window.clearInterval(stallPoll);
    if (abortBySession.get(sessionId) === abort) abortBySession.delete(sessionId);
    if (reconnectAfterTransportLoss) {
      await resumeInterruptedTurn(sessionId, { takeover: true });
    } else {
      setState({ sendingBySession: { ...state.sendingBySession, [sessionId]: false } });
      await settleSteerInbox(sessionId);
      const next = (getSnapshot().queueBySession[sessionId] ?? [])[0];
      if (next && getSnapshot().turnOutcomeBySession[sessionId] === 'completed') void continueQueue(sessionId);
      // A watchdog trip means the provider stopped answering — retry the turn
      // automatically (shared budget with the proactive stall detector)
      // instead of leaving the user staring at a dead error banner.
      const lastError = getSnapshot().errorBySession[sessionId];
      if (
        UPSTREAM_STALL_ERRORS.has(lastError ?? '') &&
        (autoRetryBySession.get(sessionId) ?? 0) < AUTO_RETRY_LIMIT
      ) {
        autoRetryBySession.set(sessionId, (autoRetryBySession.get(sessionId) ?? 0) + 1);
        setState({
          errorBySession: { ...getSnapshot().errorBySession, [sessionId]: '上游超时，正在自动重试…' },
        });
        window.setTimeout((): void => void retryInterruptedTurn(sessionId), 1200);
      }
    }
  }
}

function isIncompleteStream(err: unknown): boolean {
  return err instanceof Error && err.name === 'ChatStreamIncompleteError';
}

/** Reattach to a turn that was streaming when the connection/app dropped. */
export async function resumeInterruptedTurn(
  sessionId: string,
  opts: { takeover?: boolean } = {},
): Promise<void> {
  if (state.sendingBySession[sessionId] && !opts.takeover) return;
  const abort = new AbortController();
  abortBySession.set(sessionId, abort);
  const meta = streamMetaBySession.get(sessionId);
  if (!opts.takeover) {
    fenceBySession.set(sessionId, createFence(sessionId));
    resetReveals(sessionId);
  }

  const acc = {
    text: opts.takeover ? (state.streamingBySession[sessionId] ?? '') : '',
    reasoning: opts.takeover ? (state.streamingReasoningBySession[sessionId] ?? '') : '',
    tools: opts.takeover ? [...(state.streamingToolsBySession[sessionId] ?? [])] : [],
    activities: opts.takeover ? [...(state.replyActivitiesBySession[sessionId] ?? [])] : [],
  };
  if (opts.takeover) {
    if (acc.text) {
      getReveal(sessionId).push(acc.text);
      getReveal(sessionId).flush();
    }
    if (acc.reasoning) {
      getReasoningReveal(sessionId).push(acc.reasoning);
      getReasoningReveal(sessionId).flush();
    }
  }

  setState({
    sendingBySession: { ...state.sendingBySession, [sessionId]: true },
    ...(opts.takeover
      ? {
          errorBySession: { ...state.errorBySession, [sessionId]: '回复连接中断，正在恢复…' },
        }
      : {
          streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
          streamingReasoningBySession: { ...state.streamingReasoningBySession, [sessionId]: '' },
          reasoningStartedAtBySession: { ...state.reasoningStartedAtBySession, [sessionId]: undefined },
          turnStartedAtBySession: { ...state.turnStartedAtBySession, [sessionId]: Date.now() },
          lastProgressAtBySession: { ...state.lastProgressAtBySession, [sessionId]: Date.now() },
          lastTextAtBySession: { ...state.lastTextAtBySession, [sessionId]: undefined },
          streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
          replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
          replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: 'thinking' },
          errorBySession: { ...state.errorBySession, [sessionId]: null },
          turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: null },
          interruptRequestedBySession: { ...state.interruptRequestedBySession, [sessionId]: false },
        }),
  });

  try {
    await api.resumeTurn(
      sessionId,
      meta?.rev ?? -1,
      meta?.epoch ?? null,
      makeEventFolder(sessionId, acc),
      abort.signal,
    );
    await reconcileAfterTurn(sessionId, state.turnOutcomeBySession[sessionId] ?? undefined);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    // Resume failing is non-fatal — leave the interrupted banner visible.
    setState({
      streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
      replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
      replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
      errorBySession: { ...state.errorBySession, [sessionId]: '回复连接中断，无法自动恢复' },
      turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: 'interrupted' },
      interruptRequestedBySession: { ...state.interruptRequestedBySession, [sessionId]: false },
    });
  } finally {
    if (abortBySession.get(sessionId) === abort) abortBySession.delete(sessionId);
    setState({ sendingBySession: { ...state.sendingBySession, [sessionId]: false } });
  }
}

/** Undo one saved memory — deletes the file server-side and marks it removed. */
export async function forgetMemoryItem(sessionId: string, eventId: string, file: string): Promise<void> {
  await api.deleteMemoryFile(file, sessionId);
  setState({
    memoryEventsBySession: {
      ...state.memoryEventsBySession,
      [sessionId]: (state.memoryEventsBySession[sessionId] ?? []).map((e) =>
        e.id === eventId ? { ...e, items: e.items.filter((i) => i.file !== file) } : e,
      ),
    },
  });
}

export async function stopMessage(sessionId: string): Promise<void> {
  if (!state.sendingBySession[sessionId]) return;
  setState({ interruptRequestedBySession: { ...state.interruptRequestedBySession, [sessionId]: true } });
  try {
    // Keep the stream attached so the backend's terminal interrupted event is
    // observed before sending is released.
    await api.stopMessage(sessionId);
  } catch (err) {
    abortBySession.get(sessionId)?.abort();
    setState({
      errorBySession: { ...state.errorBySession, [sessionId]: (err as Error).message },
      turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: 'interrupted' },
    });
  }
}

export async function answerPermission(
  sessionId: string,
  decision: 'allow' | 'deny' | 'allow-session',
): Promise<void> {
  const pending = state.interactionBySession[sessionId];
  if (!pending || pending.kind !== 'permission') return;
  // Optimistic dismiss — restore on failure. If the stream has already queued
  // the next permission, leave that one showing.
  const current = state.interactionBySession[sessionId];
  if (current?.kind === 'permission' && current.id === pending.id) {
    setState({ interactionBySession: { ...state.interactionBySession, [sessionId]: null } });
  }
  try {
    await api.answerPermission(sessionId, pending.id, decision);
  } catch (err) {
    setState({ interactionBySession: { ...state.interactionBySession, [sessionId]: pending } });
    throw err;
  }
}

export async function answerAsk(sessionId: string, answers: Record<string, string>): Promise<void> {
  const pending = state.interactionBySession[sessionId];
  if (!pending || pending.kind !== 'ask') return;
  // Optimistic: the card dismisses on click; a slow/failed request restores it
  // so a hung POST never leaves the card looking unanswered. If the stream
  // already queued the next ask, leave that one showing.
  const current = state.interactionBySession[sessionId];
  if (current?.kind === 'ask' && current.id === pending.id) {
    setState({ interactionBySession: { ...state.interactionBySession, [sessionId]: null } });
  }
  let res: { ok: boolean; live?: boolean };
  try {
    res = await api.answerAsk(sessionId, pending.id, answers);
  } catch (err) {
    setState({ interactionBySession: { ...state.interactionBySession, [sessionId]: pending } });
    throw err;
  }
  // The card survived an app restart but its turn didn't — nothing will
  // consume the answer. Send it as a normal message so the agent picks up.
  if (res.ok && res.live === false) {
    const lines = pending.questions.map((q) => {
      const answer = answers[q.id];
      if (!answer) return null;
      const label = q.directions?.find((d) => d.id === answer)?.title ?? answer;
      return `${q.prompt}：${label}`;
    }).filter((line): line is string => line !== null);
    const text = lines.length > 0 ? lines.join('\n') : Object.values(answers).join('\n');
    await sendMessage(sessionId, `（对之前提问的回答）\n${text}`);
  }
}
