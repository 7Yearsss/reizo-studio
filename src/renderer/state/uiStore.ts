import * as tabStore from './tabStore';

export type SidebarMode = 'chat' | 'projects' | 'skills' | 'artifacts' | 'automation' | 'settings';
export type SettingsSection = 'general' | 'providers' | 'memory' | 'experts' | 'extensions' | 'usage' | 'storage' | 'about';
export type RightPanelTab = 'canvas' | 'video' | 'sheets' | 'documents' | 'presentations' | 'artifacts' | 'files' | 'git' | 'terminal';

export interface UiState {
  mode: SidebarMode;
  settingsSection: SettingsSection;
  settingsOpen: boolean;
  selectedProjectId: string | null;
  artifactsOpen: boolean;
  canvasOpen: boolean;
  rightPanelTab: RightPanelTab | null;
  rightPanelWidth: number;
  rightPanelMaximized: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
}

const MODE_KEY = 'reizo:sidebar-mode';
const PROJECT_KEY = 'reizo:selected-project';
const ARTIFACTS_KEY = 'reizo:artifacts-open';
const CANVAS_KEY = 'reizo:canvas-open';
const RIGHT_WIDTH_KEY = 'reizo:right-panel-width';
const ARTIFACT_WIDTH_KEY = 'reizo:artifact-panel-width';
const RIGHT_TAB_KEY = 'reizo:right-panel-tab';
const SIDEBAR_COLLAPSED_KEY = 'reizo:sidebar-collapsed';
const SIDEBAR_WIDTH_KEY = 'reizo:sidebar-width';

export const SIDEBAR_DEFAULT_WIDTH = 248;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_COLLAPSE_THRESHOLD = 110;

export const RIGHT_PANEL_MIN = 320;
export const RIGHT_PANEL_DEFAULT = 480;
export const ARTIFACT_PANEL_DEFAULT = 320;
export const CHAT_PANEL_MIN = 300;

export function getRightPanelMax(): number {
  if (typeof window === 'undefined') return 1200;
  return Math.max(RIGHT_PANEL_MIN, window.innerWidth - CHAT_PANEL_MIN);
}

function readMode(): SidebarMode {
  if (typeof localStorage === 'undefined') return 'chat';
  const raw = localStorage.getItem(MODE_KEY);
  if (
    raw === 'chat' ||
    raw === 'projects' ||
    raw === 'skills' ||
    raw === 'artifacts' ||
    raw === 'automation'
  ) return raw;
  return 'chat';
}

function readRightWidth(tab: RightPanelTab | null): number {
  const defaultWidth = tab === 'artifacts' ? ARTIFACT_PANEL_DEFAULT : RIGHT_PANEL_DEFAULT;
  const key = tab === 'artifacts' ? ARTIFACT_WIDTH_KEY : RIGHT_WIDTH_KEY;
  if (typeof localStorage === 'undefined') return defaultWidth;
  const raw = Number(localStorage.getItem(key));
  if (!Number.isFinite(raw) || raw <= 0) return defaultWidth;
  return Math.max(RIGHT_PANEL_MIN, raw);
}

function readSidebarWidth(): number {
  if (typeof localStorage === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
  const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, raw));
}

function readRightTab(): RightPanelTab | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(RIGHT_TAB_KEY);
  if (raw === 'canvas' || raw === 'video' || raw === 'sheets' || raw === 'documents' || raw === 'presentations' || raw === 'artifacts' || raw === 'files' || raw === 'git' || raw === 'terminal') {
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
  settingsSection: 'providers',
  settingsOpen: false,
  selectedProjectId: typeof localStorage !== 'undefined' ? localStorage.getItem(PROJECT_KEY) : null,
  artifactsOpen: initialTab === 'artifacts',
  canvasOpen: initialTab === 'canvas',
  rightPanelTab: initialTab,
  rightPanelWidth: readRightWidth(initialTab),
  rightPanelMaximized: false,
  sidebarCollapsed: readSidebarCollapsed(),
  sidebarWidth: readSidebarWidth(),
};

const listeners = new Set<() => void>();

function setState(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  if (typeof localStorage !== 'undefined') {
    try {
      // Persist only the keys that actually changed — drag handlers call this
      // per pointermove, so writing all keys each time would serialize the
      // whole store on every frame.
      if ('mode' in patch) localStorage.setItem(MODE_KEY, state.mode);
      if ('selectedProjectId' in patch) {
        if (state.selectedProjectId) localStorage.setItem(PROJECT_KEY, state.selectedProjectId);
        else localStorage.removeItem(PROJECT_KEY);
      }
      if ('artifactsOpen' in patch) localStorage.setItem(ARTIFACTS_KEY, state.artifactsOpen ? '1' : '0');
      if ('canvasOpen' in patch) localStorage.setItem(CANVAS_KEY, state.canvasOpen ? '1' : '0');
      if ('rightPanelTab' in patch) {
        if (state.rightPanelTab) localStorage.setItem(RIGHT_TAB_KEY, state.rightPanelTab);
        else localStorage.removeItem(RIGHT_TAB_KEY);
      }
      if ('rightPanelWidth' in patch) {
        const key = state.rightPanelTab === 'artifacts' ? ARTIFACT_WIDTH_KEY : RIGHT_WIDTH_KEY;
        localStorage.setItem(key, String(state.rightPanelWidth));
      }
      if ('sidebarCollapsed' in patch) localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.sidebarCollapsed ? '1' : '0');
      if ('sidebarWidth' in patch) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
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

export function openSettings(section: SettingsSection | 'admin' = 'providers'): void {
  setState({ settingsOpen: true, settingsSection: section === 'admin' ? 'providers' : section });
}

export function closeSettings(): void {
  setState({ settingsOpen: false });
}

export function setMode(mode: SidebarMode): void {
  if (mode === 'settings') { openSettings(); return; }
  setState({ mode });
}

export function selectProject(id: string | null): void {
  setState({ selectedProjectId: id });
}

export function setRightPanelTab(tab: RightPanelTab | null): void {
  if (state.rightPanelTab === tab) return;
  // The compact artifact list must not inherit a canvas/editor's wide layout.
  // Keep a user's explicit artifact resize separate from the editor preference.
  const changesWidthGroup = (state.rightPanelTab === 'artifacts') !== (tab === 'artifacts');
  setState({
    rightPanelTab: tab,
    canvasOpen: tab === 'canvas',
    artifactsOpen: tab === 'artifacts',
    ...(changesWidthGroup ? { rightPanelWidth: readRightWidth(tab), rightPanelMaximized: false } : {}),
  });
}

// The right panel (canvas / video / sheets …) belongs to the conversation tab it
// was opened in: remember it per tab and restore it when switching back.
const panelByTab = new Map<string, RightPanelTab | null>();
let lastActiveTabId = tabStore.getSnapshot().activeTabId;
tabStore.subscribe(() => {
  const { activeTabId, tabs } = tabStore.getSnapshot();
  if (activeTabId === lastActiveTabId) return;
  panelByTab.set(lastActiveTabId, state.rightPanelTab);
  lastActiveTabId = activeTabId;
  for (const id of panelByTab.keys()) if (!tabs.some((t) => t.id === id)) panelByTab.delete(id);
  setRightPanelTab(panelByTab.get(activeTabId) ?? null);
});

/** Open a panel on behalf of a session (e.g. an agent tool result). If that
 * session isn't the visible tab, queue it on its own tab instead of hijacking
 * whichever conversation the user is looking at. */
export function setRightPanelTabForSession(sessionId: string, tab: RightPanelTab | null): void {
  const { tabs, activeTabId } = tabStore.getSnapshot();
  const owners = tabs.filter((t) => t.kind === 'chat' && t.sessionId === sessionId);
  if (owners.length === 0 || owners.some((t) => t.id === activeTabId)) {
    setRightPanelTab(tab);
    return;
  }
  for (const t of owners) panelByTab.set(t.id, tab);
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
  const max = getRightPanelMax();
  setState({
    rightPanelWidth: Math.min(max, Math.max(RIGHT_PANEL_MIN, Math.round(width))),
    rightPanelMaximized: false,
  });
}

export function setRightPanelMaximized(maximized: boolean): void {
  setState({ rightPanelMaximized: maximized });
}

export function toggleRightPanelMaximized(): void {
  setState({ rightPanelMaximized: !state.rightPanelMaximized });
}

export function setSidebarWidth(width: number): void {
  setState({
    sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width))),
  });
}

export function toggleSidebar(): void {
  setState({ sidebarCollapsed: !state.sidebarCollapsed });
}

export function setSidebarCollapsed(collapsed: boolean): void {
  setState({ sidebarCollapsed: collapsed });
}
