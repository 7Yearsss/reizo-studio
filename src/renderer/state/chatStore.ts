import * as api from '../api';
import type { ChatMessage, SessionSummary, ToolCallPart } from '../../main/server/storage/ports';
import type { AskQuestion, TodoItem } from '../../shared/stream';
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

export interface QueuedTurn {
  id: string;
  text: string;
  mentions: string[];
  extra: { skillId?: string; attachments?: { name: string; content: string }[] };
}

export interface ChatState {
  sessions: SessionSummary[];
  sessionsLoaded: boolean;
  messagesBySession: Record<string, ChatMessage[]>;
  streamingBySession: Record<string, string>;
  streamingToolsBySession: Record<string, ToolCallPart[]>;
  sendingBySession: Record<string, boolean>;
  errorBySession: Record<string, string | null>;
  permissionBySession: Record<string, PendingPermission | null>;
  askBySession: Record<string, PendingAsk | null>;
  todosBySession: Record<string, TodoItem[]>;
  queueBySession: Record<string, QueuedTurn[]>;
}

let state: ChatState = {
  sessions: [],
  sessionsLoaded: false,
  messagesBySession: {},
  streamingBySession: {},
  streamingToolsBySession: {},
  sendingBySession: {},
  errorBySession: {},
  permissionBySession: {},
  askBySession: {},
  todosBySession: {},
  queueBySession: {},
};

const abortBySession = new Map<string, AbortController>();
const listeners = new Set<() => void>();

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
  setState({
    sessions: state.sessions.filter((s) => s.id !== id),
    messagesBySession,
    streamingBySession,
    streamingToolsBySession,
  });
  tabStore.closeSessionTabs(id);
  artifactStore.dropSessionArtifacts(id);
}

export async function ensureSessionMessages(id: string): Promise<void> {
  if (state.messagesBySession[id]) return;
  const session = await api.getSession(id);
  setState({ messagesBySession: { ...state.messagesBySession, [id]: session.messages } });
}

export async function sendMessage(
  sessionId: string,
  text: string,
  mentions: string[] = [],
  extra: { skillId?: string; attachments?: { name: string; content: string }[] } = {},
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
  await dispatchTurn(sessionId, text, mentions, extra);
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
  await dispatchTurn(sessionId, next.text, next.mentions, next.extra);
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

async function dispatchTurn(
  sessionId: string,
  text: string,
  mentions: string[] = [],
  extra: { skillId?: string; attachments?: { name: string; content: string }[] } = {},
): Promise<void> {
  const userMessage: ChatMessage = {
    id: `local-${Date.now()}`,
    role: 'user',
    content: text,
    createdAt: new Date().toISOString(),
  };
  const existing = state.messagesBySession[sessionId] ?? [];
  const abort = new AbortController();
  abortBySession.set(sessionId, abort);

  setState({
    messagesBySession: { ...state.messagesBySession, [sessionId]: [...existing, userMessage] },
    sendingBySession: { ...state.sendingBySession, [sessionId]: true },
    streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
    streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
    errorBySession: { ...state.errorBySession, [sessionId]: null },
    permissionBySession: { ...state.permissionBySession, [sessionId]: null },
    askBySession: { ...state.askBySession, [sessionId]: null },
  });

  const settings = settingsStore.getSnapshot().settings;

  try {
    let full = '';
    let tools: ToolCallPart[] = [];
    await api.sendMessage(sessionId, text, {
      providerId: settings.activeProviderId,
      model: settings.providers.find((p) => p.id === settings.activeProviderId)?.model,
      mentions,
      skillId: extra.skillId,
      attachments: extra.attachments,
      signal: abort.signal,
      onEvent: (event) => {
        if (event.type === 'text') {
          full += event.delta;
          setState({ streamingBySession: { ...state.streamingBySession, [sessionId]: full } });
        } else if (event.type === 'tool') {
          const next = tools.filter((t) => t.id !== event.id);
          next.push({
            type: 'tool',
            id: event.id,
            name: event.name,
            args: event.args,
            result: event.result,
            error: event.error,
          });
          tools = next;
          setState({
            streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: next },
            permissionBySession: { ...state.permissionBySession, [sessionId]: null },
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
        } else if (event.type === 'permission') {
          setState({
            permissionBySession: {
              ...state.permissionBySession,
              [sessionId]: { id: event.id, name: event.name, args: event.args },
            },
          });
        } else if (event.type === 'ask') {
          setState({
            askBySession: {
              ...state.askBySession,
              [sessionId]: { id: event.id, questions: event.questions },
            },
          });
        } else if (event.type === 'todos') {
          setState({ todosBySession: { ...state.todosBySession, [sessionId]: event.items } });
        } else if (event.type === 'error') {
          setState({ errorBySession: { ...state.errorBySession, [sessionId]: event.error } });
        }
      },
    });

    const session = await api.getSession(sessionId);
    const sessions = state.sessions.map((s) =>
      s.id === sessionId
        ? { id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, workspacePath: session.workspacePath, projectId: session.projectId }
        : s,
    );
    setState({
      sessions,
      messagesBySession: { ...state.messagesBySession, [sessionId]: session.messages },
      streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
      streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
      permissionBySession: { ...state.permissionBySession, [sessionId]: null },
      askBySession: { ...state.askBySession, [sessionId]: null },
    });
    tabStore.renameChatTab(sessionId, session.title);
    void artifactStore.loadSessionArtifacts(sessionId);
    notifyIfHidden(session.title);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    setState({ errorBySession: { ...state.errorBySession, [sessionId]: (err as Error).message } });
  } finally {
    if (abortBySession.get(sessionId) === abort) abortBySession.delete(sessionId);
    setState({ sendingBySession: { ...state.sendingBySession, [sessionId]: false } });
    const next = (getSnapshot().queueBySession[sessionId] ?? [])[0];
    if (next) void continueQueue(sessionId);
  }
}

export async function stopMessage(sessionId: string): Promise<void> {
  abortBySession.get(sessionId)?.abort();
  await api.stopMessage(sessionId).catch((): undefined => undefined);
  setState({
    sendingBySession: { ...state.sendingBySession, [sessionId]: false },
    streamingBySession: { ...state.streamingBySession, [sessionId]: '' },
    streamingToolsBySession: { ...state.streamingToolsBySession, [sessionId]: [] },
    permissionBySession: { ...state.permissionBySession, [sessionId]: null },
    askBySession: { ...state.askBySession, [sessionId]: null },
  });
}

export async function answerPermission(
  sessionId: string,
  decision: 'allow' | 'deny' | 'allow-session',
): Promise<void> {
  const pending = state.permissionBySession[sessionId];
  if (!pending) return;
  await api.answerPermission(sessionId, pending.id, decision);
  setState({ permissionBySession: { ...state.permissionBySession, [sessionId]: null } });
}

export async function answerAsk(sessionId: string, answers: Record<string, string>): Promise<void> {
  const pending = state.askBySession[sessionId];
  if (!pending) return;
  await api.answerAsk(sessionId, pending.id, answers);
  setState({ askBySession: { ...state.askBySession, [sessionId]: null } });
}
