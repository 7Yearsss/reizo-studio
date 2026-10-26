import type { Session, SessionSummary } from '../shared/chat';
import type { EditorImportJob, EditorImportResult, VideoEditorWorkspace } from '../shared/videoEditor';
import type { EditorActivity, EditorContext, EditorObservation } from '../shared/videoEditorContext';

import type { Project } from '../shared/project';
import type { Artifact, ArtifactVersion, ArtifactWithContent } from '../shared/artifact';
import type { DirEntry } from '../shared/workspace';
import type { PublicSettings, SettingsPatch } from '../shared/settings';
import type { Schedule, Thought } from '../shared/schedule';
import { SCHEDULE_PRESETS } from '../shared/schedule';
import { parseStreamLine, type AskQuestion, type ChatStreamEvent, type MemoryEventRecord } from '../shared/stream';
import { isLiveEnvelope } from '../shared/liveRevision';
import type { CanvasSnapshot, CanvasEdge, CanvasNode, CanvasNodeParams, CanvasNodeType, CanvasNodeOutput } from '../shared/canvas';
import { isCanvasEnvelope, type CanvasEvent } from '../shared/canvasStream';
import { isCanvasSyncMessage, type CanvasSyncMessage } from '../shared/canvasSync';
import type { CanvasAsset, CanvasAssetSummary, CanvasAssetReuseInput } from '../shared/canvasAssets';
import type {
  ProviderCatalogResponse,
  ProviderCategory,
  ManagedProviderConfig,
} from '../shared/providerRegistry';

export async function openVideoEditor(sessionId: string, reconnect = false): Promise<VideoEditorWorkspace> {
  const response = await api(`/api/video-editor/${encodeURIComponent(sessionId)}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reconnect }) });
  return response.json();
}

export async function editorApprovalMode(sessionId: string, mode?: 'manual' | 'auto'): Promise<{ mode: 'manual' | 'auto' }> {
  return (await api(`/api/video-editor/${encodeURIComponent(sessionId)}/approval`, mode === undefined ? undefined : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
  })).json();
}

function editorMediaPath(sessionId: string) { return `/api/video-editor/${encodeURIComponent(sessionId)}/media`; }
export async function listEditorMedia(sessionId: string): Promise<{ assets: CanvasAsset[] }> {
  return (await api(editorMediaPath(sessionId))).json();
}
export async function importEditorMedia(sessionId: string, assetId: string): Promise<EditorImportResult> {
  return (await api(`${editorMediaPath(sessionId)}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId }) })).json();
}
export async function editorMediaJobs(sessionId: string): Promise<{ jobs: EditorImportJob[] }> {
  return (await api(`${editorMediaPath(sessionId)}/jobs`)).json();
}
export async function editorMediaFile(sessionId: string, jobId: string): Promise<Blob> {
  return (await api(`${editorMediaPath(sessionId)}/jobs/${encodeURIComponent(jobId)}/file`)).blob();
}
export async function completeEditorMedia(sessionId: string, jobId: string, result: { asset?: EditorImportResult; error?: string }): Promise<void> {
  await api(`${editorMediaPath(sessionId)}/jobs/${encodeURIComponent(jobId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
}
export async function saveEditorExport(sessionId: string, projectId: string, name: string, blob: Blob, purpose: 'export' | 'source' = 'export'): Promise<{ asset: CanvasAsset }> {
  return (await api(`${editorMediaPath(sessionId)}/exports?${new URLSearchParams({ projectId, name, purpose })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob })).json();
}
export async function prepareEditorArtifact(sessionId: string, artifactId: string, version: number): Promise<{ asset: CanvasAsset }> {
  return (await api(`${editorMediaPath(sessionId)}/artifact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, version }) })).json();
}
export async function readEditorContext(sessionId: string): Promise<EditorObservation> {
  return (await api(`/api/video-editor/${encodeURIComponent(sessionId)}/context`)).json();
}
export async function editorRenderRequest(sessionId: string, method: 'GET' | 'POST' | 'DELETE', id?: string, payload?: unknown): Promise<unknown> {
  return (await api(`/api/video-editor/${encodeURIComponent(sessionId)}/render-jobs${id ? `/${encodeURIComponent(id)}` : ''}`, {
    method, ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  })).json();
}
export async function retryEditorExport(sessionId: string, id: string): Promise<void> {
  await api(`/api/video-editor/${encodeURIComponent(sessionId)}/render-jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}
export async function readCompositionImage(sessionId: string, id: string, index: number): Promise<Blob> {
  return (await api(`/api/video-editor/${encodeURIComponent(sessionId)}/previews/${encodeURIComponent(id)}/${index}`)).blob();
}
export async function updateEditorContext(sessionId: string, context: EditorContext, activities: EditorActivity[]): Promise<void> {
  await api(`/api/video-editor/${encodeURIComponent(sessionId)}/context`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, activities }) });
}

export interface StreamMeta {
  rev: number;
  epoch: string;
}
export type StreamEventHandler = (event: ChatStreamEvent, meta?: StreamMeta) => void;

export class ChatStreamIncompleteError extends Error {
  constructor() {
    super('Response stream ended before terminal turn outcome');
    this.name = 'ChatStreamIncompleteError';
  }
}

/** Reads an NDJSON body of `LiveEnvelope` lines, handing each event + its meta to `onEvent`. */
async function readEnvelopeStream(res: Response, onEvent: StreamEventHandler): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new ChatStreamIncompleteError();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  const dispatch = (line: string) => {
    if (ended) return;
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
      if (parsed.event.type === 'done') ended = true;
    } else {
      const event = parsed as ChatStreamEvent;
      onEvent(event);
      if (event.type === 'done') ended = true;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done || ended) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      dispatch(line);
      if (ended) break;
    }
  }
  dispatch(buffer);
  if (!ended) throw new ChatStreamIncompleteError();
}

let originPromise: Promise<string> | null = null;
/** Set once `originPromise` resolves — lets callers read the origin synchronously afterwards. */
let resolvedOrigin: string | null = null;
const originListeners = new Set<() => void>();

export function apiOrigin(): Promise<string> {
  if (!originPromise) {
    if (typeof window !== 'undefined' && window.reizo?.getApiOrigin) {
      originPromise = window.reizo.getApiOrigin();
    } else {
      // Browser-only QA can target an isolated fixture server; desktop uses its preload bridge.
      originPromise = Promise.resolve(import.meta.env?.DEV && import.meta.env.VITE_DEV_API_ORIGIN || 'http://127.0.0.1:47100');
    }
    void originPromise.then((o) => {
      resolvedOrigin = o;
      for (const listener of originListeners) listener();
    });
  }
  return originPromise;
}

/** Kicks off origin resolution if nothing has yet; safe/cheap to call from every render. */
export function warmApiOrigin(): void {
  void apiOrigin();
}

/** Subscribe to the api origin becoming available (fires once, after startup). For `useSyncExternalStore`. */
export function subscribeApiOrigin(listener: () => void): () => void {
  originListeners.add(listener);
  return () => originListeners.delete(listener);
}

export function getResolvedApiOrigin(): string | null {
  return resolvedOrigin;
}

/**
 * Synchronous counterpart to `canvasAssetUrl`. Returns `null` only in the brief window before
 * the api origin has resolved (once, at app startup) — after that it never needs to go async again.
 * Prefer this in components that can be mounted/unmounted repeatedly (e.g. canvas nodes scrolling
 * in and out of `onlyRenderVisibleElements`), where re-running an async effect on every remount
 * would otherwise flash the node back to its "no asset yet" state each time.
 */
export function canvasAssetUrlSync(relPath: string): string | null {
  return resolvedOrigin ? `${resolvedOrigin}/api/canvas/assets/${relPath}` : null;
}

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const origin = await apiOrigin();
  const res = await fetch(`${origin}${path}`, init);
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiRequestError(body.error ?? `Request failed: ${res.status}`, res.status);
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

export interface TrashedSession extends SessionSummary { deletedAt: string }

export async function listTrashedSessions(): Promise<{ sessions: TrashedSession[]; retentionDays: number }> {
  const res = await api('/api/sessions/trash');
  const data = (await res.json()) as { sessions?: TrashedSession[]; retentionDays?: number };
  return { sessions: data.sessions ?? [], retentionDays: data.retentionDays ?? 30 };
}

export async function restoreSession(id: string): Promise<void> {
  await api(`/api/sessions/${id}/restore`, { method: 'POST' });
}

export async function deleteSessionPermanently(id: string): Promise<void> {
  await api(`/api/sessions/${id}?permanent=1`, { method: 'DELETE' });
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

/** Mid-turn steer (插话): the message injects into the running turn at the next step boundary. */
export async function steerTurn(
  sessionId: string,
  item: { id: string; text: string; mentions?: string[] },
): Promise<{ accepted: boolean }> {
  const res = await api(`/api/sessions/${sessionId}/steer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(item),
  });
  return (await res.json()) as { accepted: boolean };
}

/** Steers the turn ended before consuming — park them back in the queue. */
export async function drainSteers(
  sessionId: string,
): Promise<{ items: { id: string; content: string }[] }> {
  const res = await api(`/api/sessions/${sessionId}/steer`, { method: 'DELETE' });
  return (await res.json()) as { items: { id: string; content: string }[] };
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

export async function answerAsk(
  sessionId: string,
  id: string,
  answers: Record<string, string>,
): Promise<{ ok: boolean; live?: boolean }> {
  const res = await api(`/api/sessions/${sessionId}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, answers }),
  });
  return res.json();
}

export interface PendingAskDto {
  toolCallId: string;
  name: string;
  kind: 'ask';
  questions?: AskQuestion[];
}

export async function getPendingInteractions(sessionId: string): Promise<PendingAskDto[]> {
  const res = await api(`/api/sessions/${sessionId}/interactions`);
  const body = await res.json();
  return body.interactions ?? [];
}

export async function fetchMemoryEvents(sessionId: string): Promise<MemoryEventRecord[]> {
  const res = await api(`/api/memory/events?sessionId=${encodeURIComponent(sessionId)}`);
  const body = await res.json();
  return Array.isArray(body.events) ? body.events : [];
}

export async function deleteMemoryFile(file: string, sessionId?: string): Promise<void> {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  await api(`/api/memory/${encodeURIComponent(file)}${q}`, { method: 'DELETE' });
}

export interface HarnessProposalDto { id: string; title: string; rationale: string; content: string; applied: boolean }

export async function listHarnessProposals(): Promise<HarnessProposalDto[]> {
  const res = await api('/api/harness/proposals');
  const body = await res.json();
  return body.proposals ?? [];
}

export async function applyHarnessProposal(id: string): Promise<void> {
  await api(`/api/harness/proposals/${encodeURIComponent(id)}/apply`, { method: 'POST' });
}

export async function listSkills(): Promise<{ id: string; name: string; description: string; prompt?: string; source: 'bundled' | 'user'; coverUrl?: string }[]> {
  const res = await api('/api/skills');
  const body = await res.json();
  return body.skills ?? [];
}

export async function getSkill(id: string): Promise<{ id: string; name: string; description: string; prompt?: string; body: string; source: 'bundled' | 'user'; coverUrl?: string } | null> {
  const res = await api(`/api/skills/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  const body = await res.json();
  return body.skill ?? null;
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
  once?: boolean;
  operationId?: string;
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

/** Models the provider's key can actually call (upstream `/models`). Throws on
 * unreachable upstream / missing key — callers fall back to the preset list. */
export async function getProviderModels(
  providerId: string,
): Promise<{ id: string; name: string }[]> {
  const res = await fetch(
    `${await apiOrigin()}/api/settings/providers/${encodeURIComponent(providerId)}/models`,
  );
  if (!res.ok) throw new Error(`models lookup failed: ${res.status}`);
  const data = (await res.json()) as { models?: { id: string; name: string }[] };
  return data.models ?? [];
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

export async function readWorkspacePreview(path: string): Promise<import('../shared/filePreview').WorkspacePreview> {
  return (await api(`/api/workspace/preview?${new URLSearchParams({ path })}`)).json();
}

export async function downloadArtifactFile(id: string, version?: number): Promise<Blob> {
  return (await api(`/api/artifacts/${encodeURIComponent(id)}/download${version ? `?v=${version}` : ''}`)).blob();
}

export async function workspaceMediaUrl(path: string): Promise<string> {
  return `${await apiOrigin()}/api/workspace/media?${new URLSearchParams({ path })}`;
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

export async function listArtifacts(): Promise<Artifact[]> {
  const res = await api('/api/artifacts');
  const { artifacts } = await res.json();
  return artifacts;
}

export async function createSessionArtifact(
  sessionId: string,
  input: {
    name: string;
    content: string;
    source?: 'attachment' | 'generated' | 'manual';
    mimeType?: string;
    kind?: string;
  },
): Promise<ArtifactWithContent> {
  const res = await api(`/api/sessions/${sessionId}/artifacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { artifact } = await res.json();
  return artifact;
}

export async function getArtifact(id: string, version?: number): Promise<ArtifactWithContent> {
  const res = await api(`/api/artifacts/${id}${version ? `?v=${version}` : ''}`);
  const { artifact } = await res.json();
  return artifact;
}

export async function getArtifactVersions(id: string): Promise<ArtifactVersion[]> {
  const res = await api(`/api/artifacts/${id}/versions`);
  const { versions } = await res.json();
  return versions;
}

export async function addArtifactVersion(id: string, content: string, expectedVersion?: number, label?: '排版'): Promise<ArtifactWithContent> {
  const res = await api(`/api/artifacts/${id}/versions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, expectedVersion, ...(label ? { label } : {}) }),
  });
  const { artifact } = await res.json();
  return artifact;
}

export async function restoreArtifactVersion(id: string, n: number, expectedVersion?: number): Promise<ArtifactWithContent> {
  const res = await api(`/api/artifacts/${id}/restore/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion }) });
  const { artifact } = await res.json();
  return artifact;
}

/** Absolute URL for a blob-backed artifact version (`<img src>` / `<video src>`). */
export async function artifactRawUrl(id: string, version?: number): Promise<string> {
  const origin = await apiOrigin();
  return `${origin}/api/artifacts/${id}/raw${version ? `?v=${version}` : ''}`;
}

export async function deleteArtifact(id: string): Promise<void> {
  await api(`/api/artifacts/${id}`, { method: 'DELETE' });
}

// --- Canvas ---

export async function exportCanvasPresentation(canvasId: string, request: import('../shared/canvasPresentation').PresentationExportRequest, operationId: string): Promise<{ jobId: string; nodeId: string; status: string }> {
  return (await api(`/api/canvas/${canvasId}/presentation-export`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify(request) })).json();
}

export async function importSheet(sessionId: string, file: File): Promise<ArtifactWithContent> {
  const res = await api(`/api/sessions/${sessionId}/artifacts/sheets/import?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: file,
  });
  return (await res.json()).artifact;
}

export async function createSheetFromTable(sessionId: string, name: string, rows: string[][]): Promise<ArtifactWithContent> {
  const res = await api(`/api/sessions/${sessionId}/artifacts/sheets/from-table`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, rows }) });
  return (await res.json()).artifact;
}

export async function createDocument(sessionId: string, name: string): Promise<ArtifactWithContent> {
  return (await (await api(`/api/sessions/${sessionId}/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json()).artifact;
}
export async function importDocument(sessionId: string, file: File): Promise<ArtifactWithContent> {
  return (await (await api(`/api/sessions/${sessionId}/documents/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })).json()).artifact;
}
/** The layout a reference .docx already has, as a spec to typeset another document by. */
export async function referenceFormat(file: File): Promise<import('../shared/documentFormat').FormatSpec> {
  return (await (await api(`/api/documents/reference-format?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })).json()).spec;
}
export async function importPresentation(sessionId: string, file: File): Promise<ArtifactWithContent> {
  return (await (await api(`/api/sessions/${sessionId}/presentations/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })).json()).artifact;
}
export async function exportDocument(id: string, options: { revisions?: boolean } = {}): Promise<Blob> { return (await api(`/api/artifacts/${id}/document.docx${options.revisions ? '?revisions=1' : ''}`)).blob(); }
export async function listArtifactReviews(id: string): Promise<import('../shared/artifactReview').ArtifactReview[]> {
  return (await (await api(`/api/artifacts/${id}/reviews`)).json()).reviews;
}
export async function reviseArtifactReview(id: string, reviewId: string, changeId: string, expectedReviewVersion: number, operation: unknown): Promise<import('../shared/artifactReview').ArtifactReview> {
  return (await (await api(`/api/artifacts/${id}/reviews/${reviewId}/changes/${changeId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedReviewVersion, operation }) })).json()).review;
}
/** Rewrite one suggestion again from the user's feedback; the suggestion's paragraph gets a fresh rewrite. */
export async function regenerateReviewChange(id: string, reviewId: string, changeId: string, expectedReviewVersion: number, feedback: string): Promise<import('../shared/artifactReview').ArtifactReview> {
  return (await (await api(`/api/artifacts/${id}/reviews/${reviewId}/changes/${changeId}/regenerate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedReviewVersion, feedback }) })).json()).review;
}
export async function decideArtifactReview(id: string, reviewId: string, expectedReviewVersion: number, changeIds: string[], decision: 'accept' | 'reject'): Promise<{ review: import('../shared/artifactReview').ArtifactReview; artifact: ArtifactWithContent }> {
  return (await api(`/api/artifacts/${id}/reviews/${reviewId}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedReviewVersion, changeIds, decision }) })).json();
}
export async function listDeliveryExports(canvasId: string, planId: string): Promise<import('../shared/canvasPresentation').DeliveryExport[]> {
  return (await (await api(`/api/canvas/${canvasId}/deliveries/${encodeURIComponent(planId)}/exports`)).json()).exports;
}
export async function listCanvasDeliveryPlans(canvasId: string): Promise<import('../shared/skillContract').SavedDeliveryPlan[]> {
  return (await (await api(`/api/canvas/${canvasId}/deliveries`)).json()).deliveries;
}

export async function getUsageSummary(options: import('../shared/usage').UsageQuery = {}): Promise<import('../shared/usage').UsageSummary> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) if (value !== undefined) query.set(key, String(value));
  return (await api(`/api/usage/summary?${query}`)).json();
}
export async function listUsageRecords(options: import('../shared/usage').UsageQuery & { jobId?: string; limit?: number; cursor?: string } = {}): Promise<import('../shared/usage').UsagePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) if (value !== undefined) query.set(key, String(value));
  return (await api(`/api/usage/records?${query}`)).json();
}

export async function requestScheduleRun(id: string, operationId: string): Promise<Schedule> {
  const response = await api(`/api/schedules/${encodeURIComponent(id)}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId }) });
  return (await response.json()).schedule;
}
export async function listPricingSnapshots(): Promise<import('../shared/usage').PricingSnapshot[]> { return (await (await api('/api/usage/pricing')).json()).snapshots; }
export async function createPricingSnapshot(input: import('../shared/usage').PricingSnapshotInput): Promise<import('../shared/usage').PricingSnapshot> {
  return (await api('/api/usage/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).json();
}
export async function recordUsageBill(input: import('../shared/usage').UsageBillInput): Promise<import('../shared/usage').UsageRecord> {
  return (await api('/api/usage/bills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).json();
}

export async function scanCanvasStorage(): Promise<import('../shared/canvasMaintenance').CanvasMaintenanceScan> {
  return (await api('/api/canvas-maintenance/scan')).json();
}
export async function quarantineCanvasFiles(token: string, paths: string[], operationId: string): Promise<import('../shared/canvasMaintenance').CanvasQuarantineBatch> {
  return (await api('/api/canvas-maintenance/quarantine', { method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify({ token, paths }) })).json();
}
export async function listCanvasQuarantine(): Promise<import('../shared/canvasMaintenance').CanvasQuarantineBatch[]> {
  return (await (await api('/api/canvas-maintenance/quarantine')).json()).batches;
}
export async function restoreCanvasFiles(batchId: string, paths: string[]): Promise<import('../shared/canvasMaintenance').CanvasQuarantineBatch> {
  return (await api(`/api/canvas-maintenance/quarantine/${encodeURIComponent(batchId)}/restore`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths }) })).json();
}

export async function canvasAssetUrl(relPath: string): Promise<string> {
  const origin = await apiOrigin();
  return `${origin}/api/canvas/assets/${relPath}`;
}

export async function getCanvas(sessionId: string, signal?: AbortSignal): Promise<CanvasSnapshot> {
  const res = await api(`/api/canvas/${sessionId}`, { signal });
  return res.json();
}

export async function editCanvas(canvasId: string, edits: import('../shared/canvasEdits').CanvasEdit[], operationId: string,
  expectedRevision?: number): Promise<CanvasSnapshot> {
  const response = await api(`/api/canvas/${canvasId}/edits`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId },
    body: JSON.stringify({ edits, expectedRevision }) });
  return (await response.json()).snapshot;
}

export async function editCanvasWithUploads(canvasId: string, edits: import('../shared/canvasEdits').CanvasEdit[],
  uploads: import('../shared/canvasEdits').CanvasEditUpload[], operationId: string): Promise<CanvasSnapshot> {
  return (await (await api(`/api/canvas/${canvasId}/edits`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify({ edits, uploads }) })).json()).snapshot;
}

export async function addCanvasNode(
  canvasId: string,
  input: { id?: string; type: CanvasNodeType; x?: number; y?: number; w?: number; h?: number; title?: string; params?: CanvasNodeParams },
  operationId?: string,
): Promise<CanvasNode> {
  const res = await api(`/api/canvas/${canvasId}/nodes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(operationId ? { 'Idempotency-Key': operationId } : {}) },
    body: JSON.stringify(input),
  });
  const { node } = await res.json();
  return node;
}

export async function patchCanvasNode(
  canvasId: string,
  id: string,
  patch: { x?: number; y?: number; w?: number; h?: number; title?: string; params?: CanvasNodeParams; output?: CanvasNodeOutput },
  mutationId?: string,
): Promise<CanvasNode> {
  const res = await api(`/api/canvas/${canvasId}/nodes/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(mutationId ? { 'Idempotency-Key': mutationId } : {}) },
    body: JSON.stringify(patch),
  });
  const { node } = await res.json();
  return node;
}

export async function deleteCanvasNode(canvasId: string, id: string, operationId?: string): Promise<void> {
  await api(`/api/canvas/${canvasId}/nodes/${id}`, { method: 'DELETE', headers: operationId ? { 'Idempotency-Key': operationId } : undefined });
}

export async function addCanvasEdge(
  canvasId: string,
  input: { sourceId: string; targetId: string; sourceHandle?: string | null; targetHandle?: string | null },
): Promise<CanvasEdge> {
  const res = await api(`/api/canvas/${canvasId}/edges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { edge } = await res.json();
  return edge;
}

export async function deleteCanvasEdge(canvasId: string, id: string): Promise<void> {
  await api(`/api/canvas/${canvasId}/edges/${id}`, { method: 'DELETE' });
}

export async function setCanvasNodeAsset(
  canvasId: string,
  id: string,
  input: { name?: string; dataBase64: string },
): Promise<CanvasNode> {
  const res = await api(`/api/canvas/${canvasId}/nodes/${id}/asset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { node } = await res.json();
  return node;
}

export async function uploadCanvasNodeMask(
  canvasId: string,
  nodeId: string,
  dataBase64: string,
): Promise<{ maskAsset: string }> {
  const res = await api(`/api/canvas/${canvasId}/nodes/${nodeId}/mask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataBase64 }),
  });
  return res.json() as Promise<{ maskAsset: string }>;
}

export async function runCanvasNode(
  canvasId: string,
  id: string,
  options: { confirmedSpend?: boolean; providerId?: string } = {},
): Promise<void> {
  await api(`/api/canvas/${canvasId}/nodes/${id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  });
}

export async function runCanvasGraph(
  canvasId: string,
  options: { confirmedSpend?: boolean; from?: string; nodeIds?: string[]; providerId?: string } = {},
): Promise<void> {
  await api(`/api/canvas/${canvasId}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  });
}

export async function stopCanvasGraph(canvasId: string): Promise<void> {
  await api(`/api/canvas/${canvasId}/run/stop`, { method: 'POST' });
}

export async function refineCanvasPrompt(
  prompt: string,
  mode: 'image' | 'video' = 'image',
): Promise<string> {
  const res = await api('/api/canvas/refine-prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, mode }),
  });
  const data = (await res.json()) as { refined?: string; error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || '提示词润色失败');
  }
  return data.refined || prompt;
}

export async function importCanvasImage(
  canvasId: string,
  input: {
    name: string;
    dataBase64: string;
    x?: number;
    y?: number;
    /** 'anchor' drops a reference pin instead of an image node. */
    type?: CanvasNodeType;
    params?: CanvasNodeParams;
  },
): Promise<CanvasNode> {
  const res = await api(`/api/canvas/${canvasId}/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { node } = await res.json();
  return node;
}

export async function saveCanvasAsset(canvasId: string, nodeId: string, assetIndex = 0): Promise<void> {
  await api(`/api/canvas/${canvasId}/nodes/${nodeId}/save-asset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetIndex }),
  });
}

export async function exportCanvasWorkflow(canvasId: string): Promise<Blob> {
  const origin = await apiOrigin();
  const res = await fetch(`${origin}/api/canvas/${canvasId}/workflow/export`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? '导出失败');
  }
  return res.blob();
}

export async function importCanvasWorkflow(
  canvasId: string,
  zipBase64: string,
): Promise<{ nodeIds: string[]; edgeIds: string[]; warnings: string[] }> {
  const res = await api(`/api/canvas/${canvasId}/workflow/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ zipBase64 }),
  });
  return res.json();
}

export async function setCanvasSelection(canvasId: string, ids: string[]): Promise<void> {
  await api(`/api/canvas/${canvasId}/selection`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

/**
 * Reads the long-lived canvas NDJSON channel. Unlike the chat stream this has
 * no terminal event — it returns cleanly when the body ends (server restart /
 * disconnect) so the caller can reconnect from the last seen `rev`.
 */
export async function readCanvasStream(
  canvasId: string,
  after: number,
  onEvent: (event: CanvasEvent, rev: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const origin = await apiOrigin();
  const res = await fetch(`${origin}/api/canvas/${canvasId}/stream?after=${after}`, { signal });
  if (!res.ok || !res.body) throw new Error(`canvas stream failed: ${res.status}`);
  await readCanvasLines(res.body, (parsed) => {
    if (isCanvasEnvelope(parsed)) onEvent(parsed.event, parsed.rev);
  }, signal);
}

export type ReusableMediaKind = 'image' | 'video' | 'audio';
export type ReuseCanvasAssetInput = CanvasAssetReuseInput;

export async function listCanvasJobs(canvasId: string, options: { status?: string; search?: string; cursor?: string; signal?: AbortSignal } = {}): Promise<import('../shared/canvasJobs').CanvasJobPage> {
  const query = new URLSearchParams({ limit: '50' });
  for (const key of ['status', 'search', 'cursor'] as const) if (options[key]) query.set(key, options[key]);
  return (await api(`/api/canvas/${canvasId}/jobs?${query}`, { signal: options.signal })).json();
}

export async function cancelCanvasJob(canvasId: string, jobId: string): Promise<void> {
  await api(`/api/canvas/${canvasId}/jobs/${jobId}/cancel`, { method: 'POST' });
}

export async function getCanvasJob(canvasId: string, jobId: string, signal?: AbortSignal): Promise<import('../shared/canvasJobs').CanvasJob> {
  const data = await (await api(`/api/canvas/${encodeURIComponent(canvasId)}/jobs/${encodeURIComponent(jobId)}`, { signal })).json();
  // Chat receipts follow an explicitly requested query recovery after a reload.
  return data.recoveryJob ?? data.job;
}

export async function queryCanvasVideoJob(canvasId: string, jobId: string): Promise<import('../shared/canvasJobs').CanvasJob> {
  return (await (await api(`/api/canvas/${encodeURIComponent(canvasId)}/jobs/${encodeURIComponent(jobId)}/query`, { method: 'POST' })).json()).job;
}

export async function retryCanvasJob(canvasId: string, jobId: string, operationId: string): Promise<{ jobId: string }> {
  return (await api(`/api/canvas/${canvasId}/jobs/${jobId}/retry`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify({ confirmedSpend: true }) })).json();
}

export async function composeCanvasVideo(canvasId: string, input: { nodeIds: string[]; width: number; height: number; fps?: number; sourceVolume?: number; audioVolume?: number; title?: string }, operationId: string): Promise<{ jobId: string; nodeId: string }> {
  return (await api(`/api/canvas/${canvasId}/compose`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify(input) })).json();
}

export async function canvasAssetLibraryPage(options: import('../shared/canvasAssets').CanvasAssetLibraryQuery & { signal?: AbortSignal } = {}): Promise<import('../shared/canvasAssets').CanvasAssetLibraryPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 40) });
  for (const key of ['kind', 'search', 'folder', 'tag', 'cursor'] as const) if (options[key] !== undefined) query.set(key, options[key]);
  return (await api(`/api/canvas/assets/library?${query}`, { signal: options.signal })).json();
}

export async function updateCanvasAssetMetadata(assetId: string, patch: import('../shared/canvasAssets').CanvasAssetMetadataPatch): Promise<CanvasAsset> {
  return (await (await api(`/api/canvas/assets/library/${assetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })).json()).asset;
}

export async function listCanvasAssets(options: { kind?: ReusableMediaKind; limit?: number; signal?: AbortSignal } = {}): Promise<CanvasAssetSummary[]> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 80) });
  if (options.kind) query.set('kind', options.kind);
  const response = await api(`/api/canvas/assets/library?${query.toString()}`, { signal: options.signal });
  return (await response.json()).assets ?? [];
}

export async function reuseCanvasAsset(canvasId: string, input: ReuseCanvasAssetInput, operationId: string, signal?: AbortSignal): Promise<{ node: CanvasNode; asset: CanvasAsset }> {
  const response = await api(`/api/canvas/${canvasId}/assets/reuse`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify(input), signal,
  });
  return response.json();
}

/** Complete document commits, with activity on a separate non-durable cursor. */
export async function readCanvasSyncStream(
  canvasId: string,
  after: number,
  onMessage: (message: CanvasSyncMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  const origin = await apiOrigin();
  signal?.throwIfAborted();
  const params = new URLSearchParams({ protocol: '2', after: String(after) });
  const res = await fetch(`${origin}/api/canvas/${canvasId}/stream?${params.toString()}`, { signal });
  if (!res.ok || !res.body) throw new Error(`canvas stream failed: ${res.status}`);
  await readCanvasLines(res.body, (parsed) => {
    if (isCanvasSyncMessage(parsed)) onMessage(parsed);
  }, signal);
}

async function readCanvasLines(body: ReadableStream<Uint8Array>, onMessage: (parsed: unknown) => void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const dispatch = (line: string) => {
    signal?.throwIfAborted();
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return; // Only malformed JSON is ignorable; consumer errors must propagate.
    }
    onMessage(parsed);
  };
  const cancel = () => { void reader.cancel().catch((): void => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) dispatch(line);
    }
    dispatch(buffer + decoder.decode());
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch((): void => undefined);
    reader.releaseLock();
  }
}

// ==========================================
// Multimodal Provider Registry APIs
// ==========================================

export async function getPublicProviderCatalog(category?: ProviderCategory): Promise<ProviderCatalogResponse> {
  const query = category ? `?category=${category}` : '';
  const res = await api(`/api/providers/catalog${query}`);
  if (!res.ok) throw new Error(`Failed to load provider catalog: ${res.status}`);
  return res.json();
}

export async function verifyAdminPasskey(passkey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const origin = await apiOrigin();
    const res = await fetch(`${origin}/api/admin/providers/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passkey }),
    });
    if (res.status === 404) {
      return { ok: false, error: '后端主进程尚未加载新路由，请彻底重启客户端应用终端 (404)' };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error || '管理员口令错误' };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || '请求失败，请检查服务连接' };
  }
}

export async function getAdminProviders(passkey: string): Promise<ManagedProviderConfig[]> {
  const res = await api('/api/admin/providers', {
    headers: { 'x-admin-passkey': passkey },
  });
  if (!res.ok) throw new Error('Unauthorized or failed to load admin providers');
  const data = await res.json();
  return data.providers ?? [];
}

export async function saveAdminProvider(
  passkey: string,
  provider: Partial<ManagedProviderConfig> & { id: string; name: string; category: ProviderCategory; driverType: string },
): Promise<ManagedProviderConfig> {
  const res = await api('/api/admin/providers', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-passkey': passkey,
    },
    body: JSON.stringify(provider),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save provider');
  }
  const data = await res.json();
  return data.provider;
}

export async function deleteAdminProvider(passkey: string, id: string): Promise<void> {
  const res = await api(`/api/admin/providers/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-passkey': passkey },
  });
  if (!res.ok) throw new Error('Failed to delete provider');
}

export async function setDefaultAdminProvider(passkey: string, category: ProviderCategory, id: string): Promise<void> {
  const res = await api(`/api/admin/providers/${id}/set-default?category=${category}`, {
    method: 'POST',
    headers: { 'x-admin-passkey': passkey },
  });
  if (!res.ok) throw new Error('Failed to set default provider');
}

export async function testAdminProvider(passkey: string, id: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await api(`/api/admin/providers/${id}/test`, {
    method: 'POST',
    headers: { 'x-admin-passkey': passkey },
  });
  return res.json();
}

