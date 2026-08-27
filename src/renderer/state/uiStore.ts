export type SidebarMode = 'chat' | 'projects' | 'skills' | 'settings';

export interface UiState {
  mode: SidebarMode;
  selectedProjectId: string | null;
  artifactsOpen: boolean;
}

const MODE_KEY = 'reizo:sidebar-mode';
const PROJECT_KEY = 'reizo:selected-project';
const ARTIFACTS_KEY = 'reizo:artifacts-open';

function readMode(): SidebarMode {
  if (typeof localStorage === 'undefined') return 'chat';
  const raw = localStorage.getItem(MODE_KEY);
  if (raw === 'chat' || raw === 'projects' || raw === 'skills' || raw === 'settings') return raw;
  return 'chat';
}

let state: UiState = {
  mode: readMode(),
  selectedProjectId: typeof localStorage !== 'undefined' ? localStorage.getItem(PROJECT_KEY) : null,
  artifactsOpen: typeof localStorage === 'undefined' ? true : localStorage.getItem(ARTIFACTS_KEY) !== '0',
};

const listeners = new Set<() => void>();

function setState(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MODE_KEY, state.mode);
      if (state.selectedProjectId) localStorage.setItem(PROJECT_KEY, state.selectedProjectId);
      else localStorage.removeItem(PROJECT_KEY);
      localStorage.setItem(ARTIFACTS_KEY, state.artifactsOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): UiState {
  return state;
}

export function setMode(mode: SidebarMode): void {
  setState({ mode });
}

export function selectProject(id: string | null): void {
  setState({ selectedProjectId: id });
}

export function setArtifactsOpen(open: boolean): void {
  setState({ artifactsOpen: open });
}

export function toggleArtifacts(): void {
  setState({ artifactsOpen: !state.artifactsOpen });
}
