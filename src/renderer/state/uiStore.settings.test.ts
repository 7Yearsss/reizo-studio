// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

it('opens settings over the workspace and preserves navigation and panel state on close', async () => {
  const ui = await import('./uiStore');
  ui.setMode('projects'); ui.selectProject('project-a'); ui.setRightPanelTab('documents'); ui.setRightPanelWidth(600);
  const workspace = ui.getSnapshot();
  ui.openSettings('usage');
  expect(ui.getSnapshot()).toEqual({ ...workspace, settingsOpen: true, settingsSection: 'usage' });
  expect(localStorage.getItem('reizo:sidebar-mode')).toBe('projects');
  ui.closeSettings();
  expect(ui.getSnapshot()).toEqual({ ...workspace, settingsSection: 'usage' });
  ui.setMode('settings');
  expect(ui.getSnapshot().settingsOpen).toBe(true);
  expect(ui.getSnapshot().mode).toBe('projects');
});

it('recovers a persisted legacy settings route into a usable workspace', async () => {
  localStorage.setItem('reizo:sidebar-mode', 'settings');
  const ui = await import('./uiStore');
  expect(ui.getSnapshot().mode).toBe('chat');
  expect(ui.getSnapshot().settingsOpen).toBe(false);
});
