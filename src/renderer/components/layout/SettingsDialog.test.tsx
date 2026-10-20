// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

vi.mock('../../pages/SettingsPage', () => ({ default: () => <div>模型设置内容</div> }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', { getItem: (): string | null => null, setItem: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('dismisses with Escape, keeps the draft mounted, and restores focus to the opening control', async () => {
  const ui = await import('../../state/uiStore');
  const { default: SettingsDialog } = await import('./SettingsDialog');
  await act(async () => root.render(<><textarea defaultValue="保留我的草稿" /><button onClick={() => ui.openSettings()}>打开设置</button><SettingsDialog /></>));
  const opener = host.querySelector('button')!;
  await act(async () => { opener.focus(); opener.click(); });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.querySelector('textarea')!.value).toBe('保留我的草稿');
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(host.querySelector('textarea')!.value).toBe('保留我的草稿');
});
