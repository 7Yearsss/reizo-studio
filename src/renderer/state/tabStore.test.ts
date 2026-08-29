import { describe, expect, it } from 'vitest';
import {
  getSnapshot,
  closeTab,
  newLauncherTab,
  openChatTab,
  selectTab,
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
