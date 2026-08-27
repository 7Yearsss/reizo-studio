import * as api from '../api';
import type { Artifact, ArtifactWithContent } from '../../shared/artifact';

export interface ArtifactState {
  bySession: Record<string, Artifact[]>;
  contentById: Record<string, ArtifactWithContent>;
  loadingBySession: Record<string, boolean>;
}

let state: ArtifactState = { bySession: {}, contentById: {}, loadingBySession: {} };
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

export async function loadArtifactContent(id: string): Promise<ArtifactWithContent | null> {
  if (state.contentById[id]) return state.contentById[id];
  try {
    const artifact = await api.getArtifact(id);
    setState({ contentById: { ...state.contentById, [id]: artifact } });
    return artifact;
  } catch {
    return null;
  }
}

export function dropSessionArtifacts(sessionId: string): void {
  const bySession = { ...state.bySession };
  delete bySession[sessionId];
  setState({ bySession });
}
