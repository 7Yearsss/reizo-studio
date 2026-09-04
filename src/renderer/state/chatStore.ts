import * as api from '../api';
import type { ChatMessage, ReplyActivity, SessionSummary, ToolCallPart } from '../../shared/chat';
import type {
  AskQuestion,
  ChatStreamEvent,
  FileDiffPreview,
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
import { trailEntryFromTool, UNDOABLE_TRAIL_VERBS } from '../../shared/agentTrail';
import * as artifactStore from './artifactStore';
import { appendTerminalLine } from './terminalStore';

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
  composerSeedBySession: Record<string, ComposerSeed | undefined>;
  /** Canvas nodes the user pulled into the composer as `@`-style references. */
  nodeRefsBySession: Record<string, { id: string; label: string }[]>;
  /** Sessions where the user dismissed the "interrupted turn" banner. */
  interruptDismissedBySession: Record<string, boolean>;
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
  composerSeedBySession: {},
  nodeRefsBySession: {},
  interruptDismissedBySession: {},
};

export function addNodeRef(sessionId: string, ref: { id: string; label: string }): void {
  const current = state.nodeRefsBySession[sessionId] ?? [];
  if (current.some((r) => r.id === ref.id)) return;
  setState({ nodeRefsBySession: { ...state.nodeRefsBySession, [sessionId]: [...current, ref] } });
}

export function removeNodeRef(sessionId: string, id: string): void {
  const current = state.nodeRefsBySession[sessionId] ?? [];
  setState({ nodeRefsBySession: { ...state.nodeRefsBySession, [sessionId]: current.filter((r) => r.id !== id) } });
}

export function clearNodeRefs(sessionId: string): void {
  if (!(state.nodeRefsBySession[sessionId]?.length)) return;
  setState({ nodeRefsBySession: { ...state.nodeRefsBySession, [sessionId]: [] } });
}

const abortBySession = new Map<string, AbortController>();
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

export async function ensureSessionMessages(id: string): Promise<void> {
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
  // A turn was in flight when we last lost the connection — try to reattach.
  if (isInterrupted(summaryOf(session)) && !state.sendingBySession[id]) {
    void resumeInterruptedTurn(id);
  }
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
  acc: { text: string; reasoning: string; tools: ToolCallPart[]; activities: ReplyActivity[] },
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
        // The agent touched the canvas — record a trail entry, spotlight the
        // affected nodes, and (P0-2) batch structural writes into the undo stack.
        {
          const trail = trailEntryFromTool(event);
          if (trail) {
            if (event.name === 'add_node' || event.name === 'create_storyboard_pipeline') {
              uiStore.setCanvasOpen(true);
            }
            canvasStore.pushTrail(sessionId, trail);
            if (trail.nodeIds.length > 0) canvasStore.spotlight(sessionId, trail.nodeIds);
            if (trail.status === 'done' && UNDOABLE_TRAIL_VERBS.has(trail.verb)) {
              canvasStore.recordAgentBatch(sessionId, trail);
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
        break;
      case 'ask':
        setState({
          ...progressPatch(sessionId),
          interactionBySession: {
            ...state.interactionBySession,
            [sessionId]: { kind: 'ask', id: event.id, questions: event.questions },
          },
        });
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
      case 'done':
        getReveal(sessionId).flush();
        getReasoningReveal(sessionId).flush();
        finishThinkingActivity(acc);
        setState({
          replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
          turnOutcomeBySession: { ...state.turnOutcomeBySession, [sessionId]: event.outcome },
          interruptRequestedBySession: { ...state.interruptRequestedBySession, [sessionId]: false },
          ...(event.error ? { errorBySession: { ...state.errorBySession, [sessionId]: event.error } } : {}),
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
  const userMessage: ChatMessage | null = turn.regenerate
    ? null
    : {
        id: `local-${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
  const nextMessages = userMessage ? [...existing, userMessage] : existing;
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
  });
  clearComposerSeed(sessionId);

  const settings = settingsStore.getSnapshot().settings;
  const acc = { text: '', reasoning: '', tools: [] as ToolCallPart[], activities: [] as ReplyActivity[] };
  let reconnectAfterTransportLoss = false;

  try {
    await api.sendMessage(sessionId, text, {
      providerId: settings.activeProviderId,
      model: settings.providers.find((p) => p.id === settings.activeProviderId)?.model,
      mentions,
      skillId: extra.skillId,
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
    if (abortBySession.get(sessionId) === abort) abortBySession.delete(sessionId);
    if (reconnectAfterTransportLoss) {
      await resumeInterruptedTurn(sessionId, { takeover: true });
    } else {
      setState({ sendingBySession: { ...state.sendingBySession, [sessionId]: false } });
      const next = (getSnapshot().queueBySession[sessionId] ?? [])[0];
      if (next && getSnapshot().turnOutcomeBySession[sessionId] === 'completed') void continueQueue(sessionId);
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
  await api.answerPermission(sessionId, pending.id, decision);
  const current = state.interactionBySession[sessionId];
  // The live stream may already have the next queued permission. Only clear
  // if we are still looking at the one we just answered.
  if (current?.kind === 'permission' && current.id === pending.id) {
    setState({ interactionBySession: { ...state.interactionBySession, [sessionId]: null } });
  }
}

export async function answerAsk(sessionId: string, answers: Record<string, string>): Promise<void> {
  const pending = state.interactionBySession[sessionId];
  if (!pending || pending.kind !== 'ask') return;
  await api.answerAsk(sessionId, pending.id, answers);
  setState({ interactionBySession: { ...state.interactionBySession, [sessionId]: null } });
}
