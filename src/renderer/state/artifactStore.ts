import * as api from '../api';
import type { Artifact, ArtifactVersion, ArtifactWithContent } from '../../shared/artifact';

export interface ArtifactState {
  bySession: Record<string, Artifact[]>;
  /** Keyed `${id}@${version}`. */
  contentByKey: Record<string, ArtifactWithContent>;
  versionsById: Record<string, ArtifactVersion[]>;
  loadingBySession: Record<string, boolean>;
}

let state: ArtifactState = {
  bySession: {},
  contentByKey: {},
  versionsById: {},
  loadingBySession: {},
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
  setState({ bySession });
}
