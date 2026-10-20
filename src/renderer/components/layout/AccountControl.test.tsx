// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountState } from '../../../shared/account';
import AccountControl from './AccountControl';

const mocks = vi.hoisted(() => ({ openSettings: vi.fn(), patchSettings: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../../state/uiStore', () => ({ openSettings: mocks.openSettings }));
vi.mock('../../state/settingsStore', () => ({ patchSettings: mocks.patchSettings }));
vi.mock('../../state/useSettingsStore', () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ settings: { appearance: 'system' } }) }));
vi.mock('../../lib/toast', () => ({ toast: { success: mocks.success, info: mocks.info, error: mocks.error } }));

const signedOut: AccountState = { status: 'signed-out', webOrigin: 'https://example.test' };
const pending: AccountState = { ...signedOut, status: 'pending', code: '1234ABCD' };
const authenticated: AccountState = { ...signedOut, status: 'authenticated', user: { id: '1', username: 'admin', displayName: 'Admin', email: null } };
let root: Root, container: HTMLDivElement;
let snapshot: AccountState;
const bridge = { accountStatus: vi.fn(), accountLogin: vi.fn(), accountLogout: vi.fn(), accountReopen: vi.fn(), accountRefresh: vi.fn(), platform: 'win32' };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  snapshot = signedOut;
  bridge.accountStatus.mockImplementation(async () => snapshot);
  bridge.accountLogin.mockResolvedValue(pending);
  bridge.accountLogout.mockResolvedValue(signedOut);
  vi.stubGlobal('reizo', bridge);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(<AccountControl />)); }
async function openMenu() {
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="账号菜单"]');
  expect(trigger).not.toBeNull();
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
}
async function select(text: string) {
  const target = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"], button')).find((element) => element.textContent?.startsWith(text));
  expect(target, text).toBeTruthy();
  await act(async () => target.click());
}
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); }

it('opens an anchored menu, routes to real settings sections, and supports the settings shortcut', async () => {
  snapshot = authenticated; await render(); await openMenu();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.success).not.toHaveBeenCalled();
  await select('本机用量'); expect(mocks.openSettings).toHaveBeenLastCalledWith('usage');
  await openMenu(); await select('设置'); expect(mocks.openSettings).toHaveBeenLastCalledWith();
  await openMenu(); await select('关于 Reizo'); expect(mocks.openSettings).toHaveBeenLastCalledWith('about');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })));
  expect(mocks.openSettings).toHaveBeenCalledTimes(4);
});

it('closes browser authorization on success and announces it only once', async () => {
  await render(); await openMenu(); await select('登录 Reizo');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await select('使用浏览器登录');
  expect(document.querySelector('[aria-label="登录确认码"]')?.textContent).toBe('1234ABCD');
  snapshot = authenticated; await poll();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain('Admin');
  expect(mocks.success).toHaveBeenCalledTimes(1);
  await poll(); expect(mocks.success).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(document.querySelector('[aria-label="账号菜单"]'));
});

it('persists theme choice from the appearance submenu', async () => {
  await render(); await openMenu();
  await select('外观');
  const dark = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find((element) => element.textContent === '深色');
  expect(dark).toBeTruthy();
  await act(async () => dark.click());
  expect(mocks.patchSettings).toHaveBeenCalledWith({ appearance: 'dark' });
});

it('shows account details only by explicit selection and returns keyboard focus on dismissal', async () => {
  snapshot = authenticated; await render(); await openMenu(); await select('账号信息');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('@admin');
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('[aria-label="账号菜单"]'));
});

it('ignores an old account status response that arrives after logout', async () => {
  snapshot = authenticated; await render();
  let finish: (state: AccountState) => void;
  bridge.accountStatus.mockImplementationOnce(() => new Promise<AccountState>((resolve) => { finish = resolve; }));
  await poll(); await openMenu(); await select('退出登录');
  expect(bridge.accountLogout).toHaveBeenCalledTimes(1);
  await act(async () => finish(authenticated));
  expect(container.textContent).toContain('未登录');
  expect(container.textContent).not.toContain('Admin');
});

it('keeps authorization open when login fails and allows retry', async () => {
  bridge.accountLogin.mockRejectedValueOnce(new Error('network'));
  await render(); await openMenu(); await select('登录 Reizo'); await select('使用浏览器登录');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(mocks.error).toHaveBeenCalledTimes(1);
  await select('使用浏览器登录'); expect(bridge.accountLogin).toHaveBeenCalledTimes(2);
  snapshot = authenticated; await poll();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
