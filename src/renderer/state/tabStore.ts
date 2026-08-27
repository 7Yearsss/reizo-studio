import { nanoid } from 'nanoid';

export type TabKind = 'launcher' | 'chat' | 'settings' | 'automation' | 'plugins';

export interface AppTab {
  id: string;
  kind: TabKind;
  title: string;
  sessionId?: string;
}

export interface TabState {
  tabs: AppTab[];
  activeTabId: string;
}

const STORAGE_KEY = 'reizo:studio-workspace-tabs';

function makeLauncher(): AppTab {
  return { id: nanoid(), kind: 'launcher', title: '新对话' };
}

function loadStored(): TabState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TabState;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    if (!parsed.tabs.some((t) => t.id === parsed.activeTabId)) {
      parsed.activeTabId = parsed.tabs[0].id;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persist(next: TabState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

const stored = loadStored();
const first = makeLauncher();

let state: TabState = stored ?? {
  tabs: [first],
  activeTabId: first.id,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<TabState>): void {
  state = { ...state, ...patch };
  persist(state);
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): TabState {
  return state;
}

function select(tabs: AppTab[], id: string): void {
  setState({ tabs, activeTabId: id });
}

/** Drop chat tabs whose sessions no longer exist after a restart. */
export function pruneMissingSessions(validSessionIds: string[]): void {
  const valid = new Set(validSessionIds);
  const tabs = state.tabs.filter((t) => t.kind !== 'chat' || (t.sessionId && valid.has(t.sessionId)));
  if (tabs.length === state.tabs.length) {
    if (!tabs.some((t) => t.id === state.activeTabId) && tabs[0]) {
      setState({ activeTabId: tabs[0].id });
    }
    return;
  }
  if (tabs.length === 0) {
    const tab = makeLauncher();
    select([tab], tab.id);
    return;
  }
  const activeGone = !tabs.some((t) => t.id === state.activeTabId);
  select(tabs, activeGone ? tabs[0].id : state.activeTabId);
}

export function newLauncherTab(): AppTab {
  const tab = makeLauncher();
  select([...state.tabs, tab], tab.id);
  return tab;
}

export function openChatTab(sessionId: string, title: string, replaceActiveLauncher = false): AppTab {
  const existing = state.tabs.find((t) => t.kind === 'chat' && t.sessionId === sessionId);
  if (existing) {
    setState({
      tabs: state.tabs.map((t) => (t.id === existing.id ? { ...t, title } : t)),
      activeTabId: existing.id,
    });
    return existing;
  }

  const active = state.tabs.find((t) => t.id === state.activeTabId);
  if (replaceActiveLauncher && active?.kind === 'launcher') {
    const next: AppTab = { ...active, kind: 'chat', sessionId, title };
    select(
      state.tabs.map((t) => (t.id === next.id ? next : t)),
      next.id,
    );
    return next;
  }

  const tab: AppTab = { id: nanoid(), kind: 'chat', sessionId, title };
  select([...state.tabs, tab], tab.id);
  return tab;
}

export function openSettingsTab(): AppTab {
  return openSingletonTab('settings', '设置');
}

export function openAutomationTab(): AppTab {
  return openSingletonTab('automation', '自动化');
}

export function openPluginsTab(): AppTab {
  return openSingletonTab('plugins', '技能');
}

function openSingletonTab(kind: Exclude<TabKind, 'chat' | 'launcher'>, title: string): AppTab {
  const existing = state.tabs.find((t) => t.kind === kind);
  if (existing) {
    setState({ activeTabId: existing.id });
    return existing;
  }
  const tab: AppTab = { id: nanoid(), kind, title };
  select([...state.tabs, tab], tab.id);
  return tab;
}

export function selectTab(id: string): void {
  if (state.tabs.some((t) => t.id === id)) setState({ activeTabId: id });
}

export function renameChatTab(sessionId: string, title: string): void {
  setState({
    tabs: state.tabs.map((t) => (t.sessionId === sessionId ? { ...t, title } : t)),
  });
}

export function closeTab(id: string): void {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0) return;

  if (state.tabs.length === 1) {
    const tab = makeLauncher();
    select([tab], tab.id);
    return;
  }

  const tabs = state.tabs.filter((t) => t.id !== id);
  const fallback = tabs[Math.min(index, tabs.length - 1)];
  select(tabs, fallback.id);
}

export function closeSessionTabs(sessionId: string): void {
  const remaining = state.tabs.filter((t) => t.sessionId !== sessionId);
  if (remaining.length === state.tabs.length) return;
  if (remaining.length === 0) {
    const tab = makeLauncher();
    select([tab], tab.id);
    return;
  }
  const activeGone = !remaining.some((t) => t.id === state.activeTabId);
  select(remaining, activeGone ? remaining[0].id : state.activeTabId);
}
