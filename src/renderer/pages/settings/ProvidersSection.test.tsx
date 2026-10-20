// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ProvidersSection from './ProvidersSection';
import type { PublicProvider } from '../../../shared/settings';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), settings: { activeProviderId: 'saved', providers: [] as PublicProvider[] } }));
vi.mock('../../state/useSettingsStore', () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ settings: mocks.settings }) }));
vi.mock('../../state/settingsStore', () => ({ patchSettings: mocks.patch }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.patch.mockReset().mockResolvedValue({});
  mocks.settings = { activeProviderId: 'saved', providers: [
    { id: 'saved', name: 'Saved', tag: '官方', hasKey: true, model: 'a', models: [{ id: 'a', name: 'Model A' }, { id: 'b', name: 'Model B' }], baseUrl: 'https://example.test/v1' },
    { id: 'new', name: 'New', tag: '官方', hasKey: false, model: 'c', models: [{ id: 'c', name: 'Model C' }], baseUrl: 'https://example.test/v1' },
    { id: 'custom', name: 'Custom', tag: '自定义', hasKey: true, model: 'local-model', models: [], baseUrl: 'http://localhost:1234/v1', allowCustomBaseUrl: true },
  ] };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ProvidersSection />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function form(name: string) { return host.querySelector<HTMLFormElement>(`form[aria-label="${name} 配置"]`)!; }
async function choose(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('aside button')].find((b) => [...b.querySelectorAll('span')].some((span) => span.textContent === name))!;
  await act(async () => button.click());
}
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(name: string) { await act(async () => form(name).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

it('browses providers without writing settings and retains separate unsaved key drafts', async () => {
  await choose('New'); await fill(form('New').querySelector('input')!, 'test-draft');
  await choose('Saved'); await choose('New');
  expect(form('New').querySelector('input')!.value).toBe('test-draft');
  expect(mocks.patch).not.toHaveBeenCalled();
  await submit('New');
  expect(mocks.patch).toHaveBeenCalledWith({ provider: { id: 'new', apiKey: 'test-draft', model: 'c' }, activeProviderId: 'new' });
});

it('changes an existing provider model without clearing its saved key', async () => {
  const select = form('Saved').querySelector('select')!;
  await act(async () => { select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await submit('Saved');
  expect(mocks.patch).toHaveBeenCalledWith({ provider: { id: 'saved', model: 'b' }, activeProviderId: 'saved' });
});

it('saves custom connection edits with the existing key intact', async () => {
  await choose('Custom');
  await fill(form('Custom').querySelector('input')!, 'http://localhost:4321/v1');
  await submit('Custom');
  expect(mocks.patch).toHaveBeenCalledWith({ provider: { id: 'custom', model: 'local-model', baseUrl: 'http://localhost:4321/v1' }, activeProviderId: 'custom' });
});

it('keeps input after a save failure and supports retry', async () => {
  mocks.patch.mockRejectedValueOnce(new Error('offline'));
  await choose('New'); await fill(form('New').querySelector('input')!, 'test-retry'); await submit('New');
  expect(form('New').querySelector('[role="alert"]')?.textContent).toContain('输入内容已保留');
  expect(form('New').querySelector('input')!.value).toBe('test-retry');
  await submit('New'); expect(mocks.patch).toHaveBeenCalledTimes(2);
});

it('does not save a blank unconfigured provider or duplicate an in-flight save', async () => {
  await choose('New'); await submit('New'); expect(mocks.patch).not.toHaveBeenCalled();
  let finish: () => void;
  mocks.patch.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await fill(form('New').querySelector('input')!, 'test-key');
  await submit('New'); await submit('New'); expect(mocks.patch).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});
