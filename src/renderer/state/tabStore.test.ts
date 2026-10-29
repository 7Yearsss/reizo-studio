import { describe, expect, it } from 'vitest';
import {
  getSnapshot,
  closeTab,
  newLauncherTab,
  openChatTab,
  selectTab,
  reopenClosedTab,
  moveTab,
  moveTabBefore,
  closeSessionTabs,
  resetClosedTabsForTest,
} from './tabStore';

describe('launcher tab navigation', () => {
  it('reuses an active launcher, resumes an unfinished launcher, and creates from chat', () => {
    const initial = getSnapshot();
    const launcher = initial.tabs.find((tab) => tab.kind === 'launcher');
    expect(launcher).toBeDefined();
    if (!launcher) return;

    expect(newLauncherTab().id).toBe(launcher.id);

    const chat = openChatTab('test-session', '绘画页面');
    expect(chat.kind).toBe('chat');
    expect(newLauncherTab().id).toBe(launcher.id);

    selectTab(chat.id);
    closeTab(launcher.id);
    const freshLauncher = newLauncherTab();
    expect(freshLauncher.kind).toBe('launcher');
    expect(freshLauncher.id).not.toBe(launcher.id);

    selectTab(freshLauncher.id);
    expect(newLauncherTab().id).toBe(freshLauncher.id);
  });
});

describe('reopen closed tab', () => {
  it('restores the last closed chat tab, skips open and deleted sessions', () => {
    resetClosedTabsForTest();
    const a = openChatTab('rc-a', 'A');
    const b = openChatTab('rc-b', 'B');
    closeTab(a.id);
    closeTab(b.id);
    expect(reopenClosedTab()?.sessionId).toBe('rc-b');
    expect(reopenClosedTab()?.sessionId).toBe('rc-a');
    expect(reopenClosedTab()).toBeUndefined();

    const c = openChatTab('rc-c', 'C');
    closeTab(c.id);
    closeSessionTabs('rc-c');
    expect(reopenClosedTab()).toBeUndefined();
  });
});

describe('moveTab', () => {
  it('reorders tabs and keeps the active one', () => {
    const a = openChatTab('mv-a', 'A');
    const b = openChatTab('mv-b', 'B');
    const before = getSnapshot().tabs.map((t) => t.id);
    moveTab(b.id, -1);
    const after = getSnapshot().tabs.map((t) => t.id);
    expect(after.indexOf(b.id)).toBe(before.indexOf(b.id) - 1);
    expect(after.indexOf(a.id)).toBe(before.indexOf(a.id) + 1);
    expect(getSnapshot().activeTabId).toBe(b.id);
  });
});

describe('moveTabBefore', () => {
  it('drops a tab into the slot of the one it is dragged onto', () => {
    const a = openChatTab('dd-a', 'A');
    const b = openChatTab('dd-b', 'B');
    const c = openChatTab('dd-c', 'C');
    moveTabBefore(c.id, a.id);
    const ids = getSnapshot().tabs.map((t) => t.id);
    expect(ids.indexOf(c.id)).toBe(ids.indexOf(a.id) - 1);
    expect(ids.indexOf(b.id)).toBeGreaterThan(ids.indexOf(a.id));
    moveTabBefore(c.id, c.id);
  });
});
