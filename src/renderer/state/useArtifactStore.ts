import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type ArtifactState } from './artifactStore';

export function useArtifactStore<T>(selector: (state: ArtifactState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
