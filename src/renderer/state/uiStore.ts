export type SidebarMode = 'chat' | 'projects' | 'skills' | 'artifacts' | 'automation' | 'settings';
export type RightPanelTab = 'canvas' | 'artifacts' | 'files' | 'git' | 'terminal';

export interface UiState {
  mode: SidebarMode;
  selectedProjectId: string | null;
  artifactsOpen: boolean;
  canvasOpen: boolean;
  rightPanelTab: RightPanelTab | null;
  rightPanelWidth: number;
  rightPanelMaximized: boolean;
  sidebarCollapsed: boolean;
}

const MODE_KEY = 'reizo:sidebar-mode';
const PROJECT_KEY = 'reizo:selected-project';
const ARTIFACTS_KEY = 'reizo:artifacts-open';
const CANVAS_KEY = 'reizo:canvas-open';
const RIGHT_WIDTH_KEY = 'reizo:right-panel-width';
const RIGHT_TAB_KEY = 'reizo:right-panel-tab';
const SIDEBAR_COLLAPSED_KEY = 'reizo:sidebar-collapsed';

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

function readRightTab(): RightPanelTab | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(RIGHT_TAB_KEY);
  if (raw === 'canvas' || raw === 'artifacts' || raw === 'files' || raw === 'git' || raw === 'terminal') {
    return raw;
  }
  if (localStorage.getItem(CANVAS_KEY) === '1') return 'canvas';
  if (localStorage.getItem(ARTIFACTS_KEY) === '1') return 'artifacts';
  return null;
}

function readSidebarCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
}

const initialTab = readRightTab();

let state: UiState = {
  mode: readMode(),
  selectedProjectId: typeof localStorage !== 'undefined' ? localStorage.getItem(PROJECT_KEY) : null,
  artifactsOpen: initialTab === 'artifacts',
  canvasOpen: initialTab === 'canvas',
  rightPanelTab: initialTab,
  rightPanelWidth: readRightWidth(),
  rightPanelMaximized: false,
  sidebarCollapsed: readSidebarCollapsed(),
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
      if (state.rightPanelTab) localStorage.setItem(RIGHT_TAB_KEY, state.rightPanelTab);
      else localStorage.removeItem(RIGHT_TAB_KEY);
      localStorage.setItem(RIGHT_WIDTH_KEY, String(state.rightPanelWidth));
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.sidebarCollapsed ? '1' : '0');
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

export function setRightPanelTab(tab: RightPanelTab | null): void {
  if (state.rightPanelTab === tab) return;
  setState({
    rightPanelTab: tab,
    canvasOpen: tab === 'canvas',
    artifactsOpen: tab === 'artifacts',
  });
}

export function toggleRightPanelTab(tab: RightPanelTab): void {
  if (state.rightPanelTab === tab) {
    setRightPanelTab(null);
  } else {
    setRightPanelTab(tab);
  }
}

export function closeRightPanel(): void {
  setRightPanelTab(null);
}

export function setArtifactsOpen(open: boolean): void {
  if (open) setRightPanelTab('artifacts');
  else if (state.rightPanelTab === 'artifacts') setRightPanelTab(null);
}

export function toggleArtifacts(): void {
  toggleRightPanelTab('artifacts');
}

export function setCanvasOpen(open: boolean): void {
  if (open) setRightPanelTab('canvas');
  else if (state.rightPanelTab === 'canvas') setRightPanelTab(null);
}

export function toggleCanvas(): void {
  toggleRightPanelTab('canvas');
}

export function setRightPanelWidth(width: number): void {
  setState({
    rightPanelWidth: Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, Math.round(width))),
    rightPanelMaximized: false,
  });
}

export function toggleRightPanelMaximized(): void {
  setState({ rightPanelMaximized: !state.rightPanelMaximized });
}

export function toggleSidebar(): void {
  setState({ sidebarCollapsed: !state.sidebarCollapsed });
}

export function setSidebarCollapsed(collapsed: boolean): void {
  setState({ sidebarCollapsed: collapsed });
}
