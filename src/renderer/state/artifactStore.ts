import * as api from '../api';
import type { Artifact, ArtifactVersion, ArtifactWithContent } from '../../shared/artifact';

export interface ArtifactState {
  bySession: Record<string, Artifact[]>;
  /** Keyed `${id}@${version}`. */
  contentByKey: Record<string, ArtifactWithContent>;
  versionsById: Record<string, ArtifactVersion[]>;
  loadingBySession: Record<string, boolean>;
  selectedIdBySession: Record<string, string | null>;
}

let state: ArtifactState = {
  bySession: {},
  contentByKey: {},
  versionsById: {},
  loadingBySession: {},
  selectedIdBySession: {},
};
const listeners = new Set<() => void>();

function setState(patch: Partial<ArtifactState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ArtifactState {
  return state;
}

export function selectArtifact(sessionId: string, id: string | null): void {
  setState({ selectedIdBySession: { ...state.selectedIdBySession, [sessionId]: id } });
}

/** Resolve the exact output before selecting it, including when the panel was closed. */
export async function openArtifact(sessionId: string, id: string): Promise<boolean> {
  try {
    const artifact = await api.getArtifact(id);
    if (artifact.sessionId !== sessionId) return false;
    upsertArtifact(artifact);
    selectArtifact(sessionId, id);
    return true;
  } catch { return false; }
}

export function upsertArtifact(artifact: ArtifactWithContent): void {
  const list = state.bySession[artifact.sessionId] ?? [];
  const current = list.find((item) => item.id === artifact.id);
  if (current && current.version > artifact.version) return;
  setState({
    bySession: { ...state.bySession, [artifact.sessionId]: current ? list.map((item) => item.id === artifact.id ? artifact : item) : [artifact, ...list] },
    contentByKey: { ...state.contentByKey, [key(artifact.id, artifact.version)]: artifact },
  });
}

export async function loadSessionArtifacts(sessionId: string): Promise<void> {
  setState({ loadingBySession: { ...state.loadingBySession, [sessionId]: true } });
  try {
    const artifacts = await api.listSessionArtifacts(sessionId);
    setState({
      bySession: { ...state.bySession, [sessionId]: artifacts },
      loadingBySession: { ...state.loadingBySession, [sessionId]: false },
    });
  } catch {
    setState({ loadingBySession: { ...state.loadingBySession, [sessionId]: false } });
  }
}

function key(id: string, version: number): string {
  return `${id}@${version}`;
}

export async function loadArtifactContent(
  id: string,
  version: number,
): Promise<ArtifactWithContent | null> {
  const k = key(id, version);
  if (state.contentByKey[k]) return state.contentByKey[k];
  try {
    const artifact = await api.getArtifact(id, version);
    setState({ contentByKey: { ...state.contentByKey, [k]: artifact } });
    return artifact;
  } catch {
    return null;
  }
}

export async function loadArtifactVersions(id: string): Promise<ArtifactVersion[]> {
  try {
    const versions = await api.getArtifactVersions(id);
    setState({ versionsById: { ...state.versionsById, [id]: versions } });
    return versions;
  } catch {
    return [];
  }
}

/** Drop cached content/versions for one artifact (after a version add/restore). */
export function invalidateArtifact(id: string): void {
  const contentByKey = { ...state.contentByKey };
  for (const k of Object.keys(contentByKey)) if (k.startsWith(`${id}@`)) delete contentByKey[k];
  const versionsById = { ...state.versionsById };
  delete versionsById[id];
  setState({ contentByKey, versionsById });
}

export function dropSessionArtifacts(sessionId: string): void {
  const bySession = { ...state.bySession };
  delete bySession[sessionId];
  const selectedIdBySession = { ...state.selectedIdBySession };
  delete selectedIdBySession[sessionId];
  setState({ bySession, selectedIdBySession });
}
