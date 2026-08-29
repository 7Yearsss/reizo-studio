import * as api from '../api';
import type { ChatMessage, ReplyActivity, SessionSummary, ToolCallPart } from '../../shared/chat';
import type { AskQuestion, ChatStreamEvent, ReplyPhase, TodoItem } from '../../shared/stream';
import type { StreamMeta } from '../api';
import { completeResync, createFence, ingestEnvelope, type Fence } from './liveRevisionFence';
import { createRevealController, type RevealController } from './revealController';
import * as settingsStore from './settingsStore';
import * as tabStore from './tabStore';
import * as uiStore from './uiStore';
import * as artifactStore from './artifactStore';
import { appendTerminalLine } from './terminalStore';

export interface PendingPermission {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface PendingAsk {
  id: string;
  questions: AskQuestion[];
}

/** Unified interaction model — permission gate or a mid-turn question. */
export type ChatInteraction =
  | { kind: 'permission'; id: string; name: string; args: Record<string, unknown> }
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
  streamingToolsBySession: Record<string, ToolCallPart[]>;
  replyActivitiesBySession: Record<string, ReplyActivity[]>;
  replyPhaseBySession: Record<string, ReplyPhase | undefined>;
  sendingBySession: Record<string, boolean>;
  errorBySession: Record<string, string | null>;
  interactionBySession: Record<string, ChatInteraction | null>;
  todosBySession: Record<string, TodoItem[]>;
  queueBySession: Record<string, QueuedTurn[]>;
  composerSeedBySession: Record<string, ComposerSeed | undefined>;
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
  streamingToolsBySession: {},
  replyActivitiesBySession: {},
  replyPhaseBySession: {},
  sendingBySession: {},
  errorBySession: {},
  interactionBySession: {},
  todosBySession: {},
  queueBySession: {},
  composerSeedBySession: {},
  interruptDismissedBySession: {},
};

const abortBySession = new Map<string, AbortController>();
/** Non-reactive: liveRevision fence + last seen stream meta, per session. */
const fenceBySession = new Map<string, Fence>();
const streamMetaBySession = new Map<string, StreamMeta>();
const revealBySession = new Map<string, RevealController>();
const listeners = new Set<() => void>();

function getReveal(sessionId: string): RevealController {
  let controller = revealBySession.get(sessionId);
  if (!controller) {
    controller = createRevealController((text) => {
      setState({ streamingBySession: { ...state.streamingBySession, [sessionId]: text } });
    });
    revealBySession.set(sessionId, controller);
  }
  return controller;
}

function setState(patch: Partial<ChatState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
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
  setState({ sessions, sessionsLoaded: true });
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
  const { [id]: _removedActivities, ...replyActivitiesBySession } = state.replyActivitiesBySession;
  const { [id]: _removedPhase, ...replyPhaseBySession } = state.replyPhaseBySession;
  fenceBySession.delete(id);
  streamMetaBySession.delete(id);
  revealBySession.get(id)?.reset();
  revealBySession.delete(id);
  setState({
    sessions: state.sessions.filter((s) => s.id !== id),
    messagesBySession,
    streamingBySession,
    streamingToolsBySession,
    streamingReasoningBySession,
    reasoningStartedAtBySession,
    replyActivitiesBySession,
    replyPhaseBySession,
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

/** Whether the "上次回复被中断" banner should show for this session. */
export function shouldShowInterruptBanner(sessionId: string): boolean {
  return (
    isInterrupted(state.sessions.find((s) => s.id === sessionId)) &&
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
  if (state.messagesBySession[id]) return;
  const session = await api.getSession(id);
  setState({
    messagesBySession: { ...state.messagesBySession, [id]: session.messages },
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...summaryOf(session) } : s)),
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

function makeEventFolder(sessionId: string, acc: { text: string; tools: ToolCallPart[]; activities: ReplyActivity[] }) {
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
        getReveal(sessionId).push(acc.text);
        finishThinkingActivity(acc);
        setState({
          replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
          replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: 'replying' },
        });
        break;
      }
      case 'reasoning': {
        const prev = state.streamingReasoningBySession[sessionId] ?? '';
        upsertThinkingActivity(acc, event.delta);
        setState({
          streamingReasoningBySession: {
            ...state.streamingReasoningBySession,
            [sessionId]: prev + event.delta,
          },
          ...(prev
            ? {}
            : {
                reasoningStartedAtBySession: {
                  ...state.reasoningStartedAtBySession,
                  [sessionId]: Date.now(),
              },
            }),
          replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
          replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: 'thinking' },
        });
        break;
      }
      case 'tool': {
        finishThinkingActivity(acc);
        const part = upsertToolPart(acc, event);
        upsertToolActivity(acc, part);
        setState({
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
          interactionBySession: {
            ...state.interactionBySession,
            [sessionId]: { kind: 'permission', id: event.id, name: event.name, args: event.args },
          },
        });
        break;
      case 'ask':
        setState({
          interactionBySession: {
            ...state.interactionBySession,
            [sessionId]: { kind: 'ask', id: event.id, questions: event.questions },
          },
        });
        break;
      case 'todos':
        setState({ todosBySession: { ...state.todosBySession, [sessionId]: event.items } });
        break;
      case 'error':
        setState({ errorBySession: { ...state.errorBySession, [sessionId]: event.error } });
        break;
      case 'status':
        if (event.phase === 'thinking') upsertThinkingActivity(acc);
        if (event.phase === 'tools' || event.phase === 'replying') finishThinkingActivity(acc);
        setState({
          replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] },
          replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: event.phase },
        });
        break;
      case 'done':
        getReveal(sessionId).flush();
        finishThinkingActivity(acc);
        setState({ replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [...acc.activities] } });
        break;
    }
  };
}

async function reconcileAfterTurn(sessionId: string): Promise<void> {
  revealBySession.get(sessionId)?.reset();
  const session = await api.getSession(sessionId);
  setState({
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...summaryOf(session) } : s)),
    messagesBySession: { ...state.messagesBySession, [sessionId]: session.messages },
    streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
    streamingReasoningBySession: { ...state.streamingReasoningBySession, [sessionId]: '' },
    reasoningStartedAtBySession: { ...state.reasoningStartedAtBySession, [sessionId]: undefined },
    streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
    replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
    replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
    interactionBySession: { ...state.interactionBySession, [sessionId]: null },
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
  getReveal(sessionId).reset();

  setState({
    messagesBySession: { ...state.messagesBySession, [sessionId]: nextMessages },
    sendingBySession: { ...state.sendingBySession, [sessionId]: true },
    streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
    streamingReasoningBySession: { ...state.streamingReasoningBySession, [sessionId]: '' },
    reasoningStartedAtBySession: { ...state.reasoningStartedAtBySession, [sessionId]: undefined },
    streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
    replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
    replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
    errorBySession: { ...state.errorBySession, [sessionId]: null },
    interactionBySession: { ...state.interactionBySession, [sessionId]: null },
    interruptDismissedBySession: { ...state.interruptDismissedBySession, [sessionId]: false },
  });
  clearComposerSeed(sessionId);

  const settings = settingsStore.getSnapshot().settings;
  const acc = { text: '', tools: [] as ToolCallPart[], activities: [] as ReplyActivity[] };

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
    await reconcileAfterTurn(sessionId);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    revealBySession.get(sessionId)?.reset();
    try {
      const session = await api.getSession(sessionId);
      setState({
        messagesBySession: { ...state.messagesBySession, [sessionId]: session.messages },
        streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
        replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
        replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
        errorBySession: { ...state.errorBySession, [sessionId]: (err as Error).message },
      });
    } catch {
      setState({ errorBySession: { ...state.errorBySession, [sessionId]: (err as Error).message } });
    }
  } finally {
    if (abortBySession.get(sessionId) === abort) abortBySession.delete(sessionId);
    setState({ sendingBySession: { ...state.sendingBySession, [sessionId]: false } });
    const next = (getSnapshot().queueBySession[sessionId] ?? [])[0];
    if (next) void continueQueue(sessionId);
  }
}

/** Reattach to a turn that was streaming when the connection/app dropped. */
export async function resumeInterruptedTurn(sessionId: string): Promise<void> {
  if (state.sendingBySession[sessionId]) return;
  const abort = new AbortController();
  abortBySession.set(sessionId, abort);
  const meta = streamMetaBySession.get(sessionId);
  fenceBySession.set(sessionId, createFence(sessionId));
  getReveal(sessionId).reset();

  setState({
    sendingBySession: { ...state.sendingBySession, [sessionId]: true },
    streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
    streamingReasoningBySession: { ...state.streamingReasoningBySession, [sessionId]: '' },
    reasoningStartedAtBySession: { ...state.reasoningStartedAtBySession, [sessionId]: undefined },
    streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
    replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
    replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
    errorBySession: { ...state.errorBySession, [sessionId]: null },
  });

  const acc = { text: '', tools: [] as ToolCallPart[], activities: [] as ReplyActivity[] };
  try {
    await api.resumeTurn(
      sessionId,
      meta?.rev ?? -1,
      meta?.epoch ?? null,
      makeEventFolder(sessionId, acc),
      abort.signal,
    );
    await reconcileAfterTurn(sessionId);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    // Resume failing is non-fatal — leave the interrupted banner visible.
    setState({
      streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
      replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
      replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
    });
  } finally {
    if (abortBySession.get(sessionId) === abort) abortBySession.delete(sessionId);
    setState({ sendingBySession: { ...state.sendingBySession, [sessionId]: false } });
  }
}

export async function stopMessage(sessionId: string): Promise<void> {
  abortBySession.get(sessionId)?.abort();
  revealBySession.get(sessionId)?.reset();
  await api.stopMessage(sessionId).catch((): undefined => undefined);
  setState({
    sendingBySession: { ...state.sendingBySession, [sessionId]: false },
    streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
    streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
    streamingReasoningBySession: { ...state.streamingReasoningBySession, [sessionId]: '' },
    reasoningStartedAtBySession: { ...state.reasoningStartedAtBySession, [sessionId]: undefined },
    replyActivitiesBySession: { ...state.replyActivitiesBySession, [sessionId]: [] },
    replyPhaseBySession: { ...state.replyPhaseBySession, [sessionId]: undefined },
    interactionBySession: { ...state.interactionBySession, [sessionId]: null },
  });
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
