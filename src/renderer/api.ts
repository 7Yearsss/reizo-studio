import type { Session, SessionSummary } from '../shared/chat';
import type { Project } from '../shared/project';
import type { Artifact, ArtifactWithContent } from '../shared/artifact';
import type { DirEntry } from '../shared/workspace';
import type { PublicSettings, SettingsPatch } from '../shared/settings';
import type { Schedule, Thought } from '../shared/schedule';
import { SCHEDULE_PRESETS } from '../shared/schedule';
import { parseStreamLine, type ChatStreamEvent } from '../shared/stream';
import { isLiveEnvelope } from '../shared/liveRevision';

export interface StreamMeta {
  rev: number;
  epoch: string;
}
export type StreamEventHandler = (event: ChatStreamEvent, meta?: StreamMeta) => void;

/** Reads an NDJSON body of `LiveEnvelope` lines, handing each event + its meta to `onEvent`. */
async function readEnvelopeStream(res: Response, onEvent: StreamEventHandler): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  const dispatch = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const fallback = parseStreamLine(trimmed);
      if (fallback) onEvent(fallback);
      return;
    }
    if (isLiveEnvelope(parsed)) {
      onEvent(parsed.event, { rev: parsed.rev, epoch: parsed.epoch });
    } else {
      onEvent(parsed as ChatStreamEvent);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) dispatch(line);
  }
  dispatch(buffer);
}

let originPromise: Promise<string> | null = null;

function apiOrigin(): Promise<string> {
  if (!originPromise) originPromise = window.reizo.getApiOrigin();
  return originPromise;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const origin = await apiOrigin();
  const res = await fetch(`${origin}${path}`, init);
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await api('/api/sessions');
  const { sessions } = await res.json();
  return sessions;
}

export async function createSession(
  title?: string,
  workspacePath?: string | null,
  projectId?: string | null,
): Promise<Session> {
  const res = await api('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, workspacePath, projectId }),
  });
  const { session } = await res.json();
  return session;
}

export async function listSessionsByProject(projectId: string): Promise<SessionSummary[]> {
  const res = await api(`/api/sessions?projectId=${encodeURIComponent(projectId)}`);
  const { sessions } = await res.json();
  return sessions;
}

export async function patchSession(
  id: string,
  patch: { title?: string; projectId?: string | null },
): Promise<Session> {
  const res = await api(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const { session } = await res.json();
  return session;
}

export async function getSession(id: string): Promise<Session> {
  const res = await api(`/api/sessions/${id}`);
  const { session } = await res.json();
  return session;
}

export async function renameSession(id: string, title: string): Promise<void> {
  await api(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}


export async function deleteSession(id: string): Promise<void> {
  await api(`/api/sessions/${id}`, { method: 'DELETE' });
}

export async function truncateSessionMessages(id: string, truncateAfterId: string): Promise<Session> {
  const res = await api(`/api/sessions/${id}/messages`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ truncateAfterId }),
  });
  const { session } = await res.json();
  return session;
}

export async function sendMessage(
  sessionId: string,
  text: string,
  options: {
    providerId?: string;
    model?: string;
    mentions?: string[];
    skillId?: string;
    attachments?: { name: string; content: string }[];
    truncateAfterId?: string;
    regenerate?: boolean;
    signal?: AbortSignal;
    onEvent: StreamEventHandler;
  },
): Promise<void> {
  const origin = await apiOrigin();
  const res = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      providerId: options.providerId,
      model: options.model,
      mentions: options.mentions,
      skillId: options.skillId,
      attachments: options.attachments,
      truncateAfterId: options.truncateAfterId,
      regenerate: options.regenerate || undefined,
    }),
    signal: options.signal,
  });

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (!contentType.includes('ndjson') && contentType.includes('json')) {
    const body = await res.json();
    throw new Error(body.error ?? 'Unexpected JSON response');
  }

  await readEnvelopeStream(res, options.onEvent);
}

/**
 * Reattach to an in-flight turn after a dropped connection / window reload.
 * Replays buffered events with `rev > after`, then tails the live turn (or
 * yields a terminal `done` if it already finished).
 */
export async function resumeTurn(
  sessionId: string,
  after: number,
  epoch: string | null,
  onEvent: StreamEventHandler,
  signal?: AbortSignal,
): Promise<void> {
  const origin = await apiOrigin();
  const params = new URLSearchParams({ after: String(after) });
  if (epoch) params.set('epoch', epoch);
  const res = await fetch(
    `${origin}/api/sessions/${sessionId}/stream/resume?${params.toString()}`,
    { signal },
  );
  if (!res.ok) throw new Error(`resume failed: ${res.status}`);
  await readEnvelopeStream(res, onEvent);
}

export async function stopMessage(sessionId: string): Promise<void> {
  await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
}

export async function answerPermission(
  sessionId: string,
  id: string,
  decision: 'allow' | 'deny' | 'allow-session',
): Promise<void> {
  await api(`/api/sessions/${sessionId}/permissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, decision }),
  });
}

export async function answerAsk(sessionId: string, id: string, answers: Record<string, string>): Promise<void> {
  await api(`/api/sessions/${sessionId}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, answers }),
  });
}

export async function listSkills(): Promise<{ id: string; name: string; description: string; source: 'bundled' | 'user' }[]> {
  const res = await api('/api/skills');
  const body = await res.json();
  return body.skills ?? [];
}

export async function listSchedules(): Promise<{ schedules: Schedule[]; presets: typeof SCHEDULE_PRESETS }> {
  const res = await api('/api/schedules');
  return res.json();
}

export async function createSchedule(input: {
  name?: string;
  prompt: string;
  intervalMs: number;
  skillId?: string;
}): Promise<Schedule> {
  const res = await api('/api/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  return body.schedule;
}

export async function updateSchedule(id: string, patch: Record<string, unknown>): Promise<Schedule> {
  const res = await api(`/api/schedules/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await res.json();
  return body.schedule;
}

export async function deleteSchedule(id: string): Promise<void> {
  await api(`/api/schedules/${id}`, { method: 'DELETE' });
}

export async function listThoughts(): Promise<Thought[]> {
  const res = await api('/api/schedules/thoughts');
  const body = await res.json();
  return body.thoughts ?? [];
}

export async function createThought(content: string): Promise<Thought> {
  const res = await api('/api/schedules/thoughts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const body = await res.json();
  return body.thought;
}

export async function deleteThought(id: string): Promise<void> {
  await api(`/api/schedules/thoughts/${id}`, { method: 'DELETE' });
}

export async function getSettings(): Promise<PublicSettings> {
  const res = await api('/api/settings');
  return res.json();
}

export async function patchSettings(patch: SettingsPatch): Promise<PublicSettings> {
  const res = await api('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return res.json();
}

export async function setOpenAiApiKey(openaiApiKey: string): Promise<PublicSettings> {
  return patchSettings({ provider: { id: 'openai', apiKey: openaiApiKey } });
}

export function pickFolder(): Promise<string | null> {
  return window.reizo.pickFolder();
}

export function listWorkspace(relativePath?: string): Promise<DirEntry[]> {
  return window.reizo.listWorkspace(relativePath);
}

export function readWorkspaceFile(relativePath: string) {
  return window.reizo.readWorkspaceFile(relativePath);
}

export function flattenWorkspace(): Promise<DirEntry[]> {
  return window.reizo.flattenWorkspace();
}

export async function listProjects(): Promise<Project[]> {
  const res = await api('/api/projects');
  const { projects } = await res.json();
  return projects;
}

export async function createProject(input: {
  name: string;
  description?: string;
  instructions?: string;
}): Promise<Project> {
  const res = await api('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { project } = await res.json();
  return project;
}

export async function getProject(id: string): Promise<Project> {
  const res = await api(`/api/projects/${id}`);
  const { project } = await res.json();
  return project;
}

export async function patchProject(
  id: string,
  patch: { name?: string; description?: string | null; instructions?: string | null },
): Promise<Project> {
  const res = await api(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const { project } = await res.json();
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await api(`/api/projects/${id}`, { method: 'DELETE' });
}

export async function listSessionArtifacts(sessionId: string): Promise<Artifact[]> {
  const res = await api(`/api/sessions/${sessionId}/artifacts`);
  const { artifacts } = await res.json();
  return artifacts;
}

export async function createSessionArtifact(
  sessionId: string,
  input: { name: string; content: string; source?: 'attachment' | 'generated'; mimeType?: string },
): Promise<ArtifactWithContent> {
  const res = await api(`/api/sessions/${sessionId}/artifacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { artifact } = await res.json();
  return artifact;
}

export async function getArtifact(id: string): Promise<ArtifactWithContent> {
  const res = await api(`/api/artifacts/${id}`);
  const { artifact } = await res.json();
  return artifact;
}

export async function deleteArtifact(id: string): Promise<void> {
  await api(`/api/artifacts/${id}`, { method: 'DELETE' });
}
