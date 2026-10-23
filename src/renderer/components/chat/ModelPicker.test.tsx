// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PublicProvider } from '../../../shared/settings';
import ModelPicker from './ModelPicker';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), providers: [] as PublicProvider[] }));
vi.mock('../../state/useSettingsStore', () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ settings: { activeProviderId: 'reizo-account', providers: mocks.providers, mediaModels: {} } }) }));
vi.mock('../../state/settingsStore', () => ({ patchSettings: mocks.patch }));
vi.mock('../models/ModelIcon', () => ({ default: () => <span aria-hidden /> }));
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  mocks.patch.mockReset().mockResolvedValue({});
  mocks.providers = [
    { id: 'reizo-account', name: 'Reizo 账号', tag: '', hasKey: true, model: '[满血G]gemini-flash', baseUrl: '', models: [{ id: '[满血G]gemini-flash', name: '[满血G]gemini-flash' }, { id: 'gpt-6-astra', name: 'GPT-6 Astra' }] },
    { id: 'openai', name: 'OpenAI 官方', tag: '', hasKey: true, model: 'gpt-6-astra', baseUrl: '', models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }] },
    { id: 'reizo', name: '尚未配置的 Reizo', tag: '', hasKey: false, model: 'gpt-6-astra', baseUrl: '', models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }] },
  ];
  mocks.providers[0].catalog = { text: [], image: [{ id: 'gpt-image-2', name: 'gpt-image-2', protocol: 'openai-image' }], video: [{ id: 'wan3.0-video', name: 'wan3.0-video', protocol: 'openai-video', video: { startFrame: false, endFrame: false, camera: false, reference: false } }] };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ModelPicker />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="模型"]')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('collapses other vendors and selects the correct provider when two providers offer the same model', async () => {
  const vendor = document.querySelector<HTMLButtonElement>('button[aria-label="OpenAI，2 个模型"]')!;
  expect(vendor.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('button[aria-label="Google，1 个模型"]')?.getAttribute('aria-expanded')).toBe('true');
  await act(async () => vendor.click());
  const option = [...document.querySelectorAll<HTMLButtonElement>('[data-model-value]')].find((element) => element.dataset.modelValue === JSON.stringify(['openai', 'gpt-6-astra']))!;
  await act(async () => option.click());
  expect(mocks.patch).toHaveBeenCalledWith({ activeProviderId: 'openai', provider: { id: 'openai', model: 'gpt-6-astra' } });
  expect(document.querySelector('[aria-label="切换模型"]')).toBeNull();
});

it('searches a vendor and preserves the gateway-prefixed model ID when selected', async () => {
  const input = document.querySelector<HTMLInputElement>('[aria-label="搜索模型或厂商"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'google');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelector('button[aria-label="OpenAI，2 个模型"]')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[data-model-value]')!.click());
  expect(mocks.patch).toHaveBeenCalledWith({ activeProviderId: 'reizo-account', provider: { id: 'reizo-account', model: '[满血G]gemini-flash' } });
});

it('switches the image default without changing the text provider', async () => {
  const image = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="模型类型"] button')].find((button) => button.textContent === '图像')!;
  await act(async () => image.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-model-value="gpt-image-2"]')!.click());
  expect(mocks.patch).toHaveBeenCalledWith({ mediaModels: { image: 'gpt-image-2' } });
});

it('lists the account video catalog and selects its exact gateway ID without static fallback models', async () => {
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="模型类型"] button')].find(button => button.textContent === '视频')?.click());
  expect(document.querySelector('[data-model-value="kling-v1"]')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[data-model-value="wan3.0-video"]')?.click());
  expect(mocks.patch).toHaveBeenCalledWith({ mediaModels: { video: 'wan3.0-video' } });
});
