export type SidebarMode = 'chat' | 'projects' | 'skills' | 'artifacts' | 'automation' | 'settings';

export interface UiState {
  mode: SidebarMode;
  selectedProjectId: string | null;
  artifactsOpen: boolean;
  canvasOpen: boolean;
  rightPanelWidth: number;
}

const MODE_KEY = 'reizo:sidebar-mode';
const PROJECT_KEY = 'reizo:selected-project';
const ARTIFACTS_KEY = 'reizo:artifacts-open';
const CANVAS_KEY = 'reizo:canvas-open';
const RIGHT_WIDTH_KEY = 'reizo:right-panel-width';

export const RIGHT_PANEL_MIN = 320;
export const RIGHT_PANEL_MAX = 960;
const RIGHT_PANEL_DEFAULT = 480;

function readMode(): SidebarMode {
  if (typeof localStorage === 'undefined') return 'chat';
  const raw = localStorage.getItem(MODE_KEY);
  if (
    raw === 'chat' ||
    raw === 'projects' ||
    raw === 'skills' ||
    raw === 'artifacts' ||
    raw === 'automation' ||
    raw === 'settings'
  ) return raw;
  return 'chat';
}

function readRightWidth(): number {
  if (typeof localStorage === 'undefined') return RIGHT_PANEL_DEFAULT;
  const raw = Number(localStorage.getItem(RIGHT_WIDTH_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return RIGHT_PANEL_DEFAULT;
  return Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, raw));
}

let state: UiState = {
  mode: readMode(),
  selectedProjectId: typeof localStorage !== 'undefined' ? localStorage.getItem(PROJECT_KEY) : null,
  // Default closed; only an explicit localStorage '1' opens artifacts on load.
  artifactsOpen: typeof localStorage !== 'undefined' && localStorage.getItem(ARTIFACTS_KEY) === '1',
  canvasOpen: typeof localStorage !== 'undefined' && localStorage.getItem(CANVAS_KEY) === '1',
  rightPanelWidth: readRightWidth(),
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
      localStorage.setItem(CANVAS_KEY, state.canvasOpen ? '1' : '0');
      localStorage.setItem(RIGHT_WIDTH_KEY, String(state.rightPanelWidth));
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

export function setCanvasOpen(open: boolean): void {
  if (state.canvasOpen === open) return;
  setState({ canvasOpen: open });
}

export function toggleCanvas(): void {
  setState({ canvasOpen: !state.canvasOpen });
}

export function setRightPanelWidth(width: number): void {
  setState({ rightPanelWidth: Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, Math.round(width))) });
}
