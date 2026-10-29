import { describe, expect, it } from 'vitest';
import {
  getSnapshot,
  closeTab,
  newLauncherTab,
  openChatTab,
  selectTab,
  reopenClosedTab,
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
