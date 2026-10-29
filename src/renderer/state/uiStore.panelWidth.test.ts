// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  window.innerWidth = 1800;
  localStorage.clear();
  vi.resetModules();
});
afterEach(() => localStorage.clear());

it('opens restored artifacts at 320px despite a legacy wide editor preference', async () => {
  localStorage.setItem('reizo:right-panel-width', '720');
  localStorage.setItem('reizo:right-panel-tab', 'artifacts');
  const ui = await import('./uiStore');
  expect(ui.getSnapshot().rightPanelWidth).toBe(320);
  ui.setRightPanelTab('canvas');
  expect(ui.getSnapshot().rightPanelWidth).toBe(720);
  ui.setRightPanelMaximized(true);
  ui.setRightPanelTab('artifacts');
  expect(ui.getSnapshot()).toMatchObject({ rightPanelWidth: 320, rightPanelMaximized: false });
});

it('remembers an explicit artifact resize independently across close, switch and reload', async () => {
  const ui = await import('./uiStore');
  ui.setRightPanelTab('canvas');
  ui.setRightPanelWidth(600);
  ui.setRightPanelTab('artifacts');
  expect(ui.getSnapshot().rightPanelWidth).toBe(320);
  ui.setRightPanelWidth(380);
  ui.closeRightPanel();
  ui.setRightPanelTab('artifacts');
  expect(ui.getSnapshot().rightPanelWidth).toBe(380);
  ui.setRightPanelTab('canvas');
  expect(ui.getSnapshot().rightPanelWidth).toBe(600);
  ui.setRightPanelTab('artifacts');
  vi.resetModules();
  const restored = await import('./uiStore');
  expect(restored.getSnapshot().rightPanelWidth).toBe(380);
  expect(localStorage.getItem('reizo:right-panel-width')).toBe('600');
});

it('each editor panel remembers its own width, falling back to the shared editor width until resized', async () => {
  const ui = await import('./uiStore');
  ui.setRightPanelTab('canvas');
  ui.setRightPanelWidth(640);
  ui.setRightPanelTab('documents');
  // Never resized: inherits the shared editor width.
  expect(ui.getSnapshot().rightPanelWidth).toBe(640);
  ui.setRightPanelWidth(460);
  ui.setRightPanelTab('canvas');
  expect(ui.getSnapshot().rightPanelWidth).toBe(640);
  ui.setRightPanelTab('documents');
  expect(ui.getSnapshot().rightPanelWidth).toBe(460);
});

it('the panel can never squeeze the conversation below its minimum next to the open sidebar', async () => {
  const ui = await import('./uiStore');
  expect(ui.rightPanelMaxFor(1024, 248)).toBe(476);
  expect(ui.rightPanelMaxFor(1024, 0)).toBe(724);
  expect(ui.rightPanelMaxFor(500, 248)).toBe(320);
  ui.setRightPanelTab('canvas');
  ui.setRightPanelWidth(99999);
  expect(ui.getSnapshot().rightPanelWidth).toBe(ui.getRightPanelMax());
  expect(ui.getRightPanelMax()).toBe(1800 - ui.getSnapshot().sidebarWidth - 300);
});
