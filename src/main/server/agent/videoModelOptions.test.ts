import { expect, it } from 'vitest';
import type { LocalSettings } from '../../../shared/settings';
import type { ProviderStore } from '../storage/providerStore';
import { videoModelOptions } from './videoModelOptions';

const support = { startFrame: true, endFrame: false, camera: false, reference: false, minSeconds: 6, maxSeconds: 10, aspectRatios: ['9:16'] };
const account = { activeProviderId: 'reizo-account', providers: { 'reizo-account': { apiKey: 'private-test-secret' } },
  mediaModels: { video: 'video-b' }, accountCatalog: { text: [], image: [], video: [
    { id: 'video-a', name: '视频模型 A', video: support }, { id: 'video-b', name: '视频模型 B', video: support },
  ] } } as unknown as LocalSettings;

it('builds the model question from the account catalog and recommends the current video model without exposing credentials', async () => {
  const result = await videoModelOptions(account);
  expect(result.question).toMatchObject({ kind: 'choice', options: ['视频模型 A · Reizo 账号', '视频模型 B · Reizo 账号'], recommended: '视频模型 B · Reizo 账号' });
  expect(result.selected).toMatchObject({ id: 'video-b', providerId: 'reizo-account', support });
  expect(JSON.stringify(result)).not.toContain('private-test-secret');
});

it('keeps the real account video models when chat uses a separate configured Reizo key', async () => {
  const result = await videoModelOptions({ ...account, activeProviderId: 'reizo', providers: {
    ...account.providers, reizo: { apiKey: 'manual-chat-key', model: 'gpt-6-astra' },
  } });
  expect(result.models.map(model => model.id)).toEqual(['video-a', 'video-b']);
  expect(result.selected).toMatchObject({ id: 'video-b', providerId: 'reizo-account' });
});

it('does not invent fallback video models when the account has no permission or is signed out', async () => {
  expect((await videoModelOptions({ ...account, accountCatalog: { text: [], image: [], video: [] } })).models).toEqual([]);
  expect((await videoModelOptions({ ...account, providers: {} })).models).toEqual([]);
});

it('lists only enabled configured video services, preserving the provider identity for duplicate model IDs', async () => {
  const item = { id: 'provider-a', name: '服务 A', category: 'video', enabled: true, hasKey: true, driverType: 'fal',
    sampleParams: { model: 'fal-ai/model' }, availableModels: [{ id: 'fal-ai/model', name: '模型' }] };
  const providerStore = { getPublicCatalog: async () => ({ providers: [item,
    { ...item, id: 'provider-b', name: '服务 B' }, { ...item, id: 'disabled', enabled: false },
    { ...item, id: 'no-key', hasKey: false }, { ...item, id: 'unknown', driverType: 'unknown' },
  ], defaultProviderByCategory: { video: 'provider-b' } }) } as unknown as ProviderStore;
  const result = await videoModelOptions({ activeProviderId: 'openai', providers: {}, mediaModels: {} } as LocalSettings, providerStore);
  expect(result.models.map(model => model.label)).toEqual(['模型 · 服务 A', '模型 · 服务 B']);
  expect(result.selected).toMatchObject({ id: 'fal-ai/model', providerId: 'provider-b' });
});
