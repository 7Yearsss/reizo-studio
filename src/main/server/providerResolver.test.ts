import { expect, it } from 'vitest';
import type { LocalSettings } from '../../shared/settings';
import type { ManagedProviderConfig } from '../../shared/providerRegistry';
import type { ProviderStore } from './storage/providerStore';
import { resolveSettingsModel, resolveVideoExecution } from './providerResolver';

it('uses the account catalog for video and image routing and rejects unavailable models', async () => {
  const settings = { activeProviderId: 'reizo-account', providers: { 'reizo-account': { apiKey: 'fixture-key', baseUrl: 'https://gateway.example/v1', model: 'chat' } }, mediaModels: { video: 'wan3.0-video', image: 'nano-banana-2.1' },
    accountCatalog: { text: [], image: [{ id: 'nano-banana-2.1', name: 'nano', protocol: 'openai-chat-image' }], video: [{ id: 'wan3.0-video', name: 'wan', protocol: 'openai-video', video: { startFrame: false, endFrame: false, reference: false, camera: false } }] } } as unknown as LocalSettings;
  expect(await resolveVideoExecution(settings, { driverId: 'mock', autoProvider: true, params: { prompt: 'fixture' } })).toMatchObject({ driver: { id: 'new-api' }, providerId: 'reizo-account', model: 'wan3.0-video', credentials: { apiKey: 'fixture-key' } });
  expect(resolveSettingsModel(settings, { category: 'image' })).toMatchObject({ modelId: 'nano-banana-2.1', protocol: 'openai-chat-image' });
  await expect(resolveVideoExecution(settings, { driverId: 'mock', autoProvider: true, params: { prompt: 'fixture', model: 'not-authorized' } })).rejects.toThrow('权限');
  expect(() => resolveSettingsModel(settings, { category: 'image', model: 'not-authorized' })).toThrow('权限');
  settings.activeProviderId = 'openai';
  expect(await resolveVideoExecution(settings, { driverId: 'new-api', submittedProviderId: 'reizo-account', params: { prompt: 'fixture', model: 'wan3.0-video' } })).toMatchObject({ providerId: 'reizo-account' });
});

it('resolves configured managed video identities and exact FAL models without changing legacy defaults or paid providers', async () => {
  const settings = { activeProviderId: 'openai', providers: { reizo: { apiKey: 'fixture-only', model: 'chat', baseUrl: 'https://fixture.invalid/v1' } }, mediaModels: {} } as unknown as LocalSettings;
  expect(resolveSettingsModel(settings, { category: 'image' })).toMatchObject({ providerId: 'reizo', modelId: 'gpt-image-2' });
  expect(() => resolveSettingsModel(settings, { category: 'image', providerId: 'openai' })).toThrow('API Key（OpenAI）');
  const provider: ManagedProviderConfig = { id: 'managed-video', name: 'Fixture video', category: 'video', enabled: true, isDefault: true, driverType: 'fal',
    createdAt: '', updatedAt: '', credentials: { apiKey: 'fixture-only', baseUrl: 'https://queue.fal.run' }, sampleParams: { model: 'fal-ai/luma-dream-machine' } };
  const store = { getByIdWithSecret: async (id: string) => id === provider.id ? provider : null,
    getPublicCatalog: async () => ({ providers: [{ ...provider, hasKey: true }], defaultProviderByCategory: { video: provider.id } }) } as unknown as ProviderStore;
  const managed = await resolveVideoExecution(settings, { driverId: provider.id, params: { prompt: 'fixture' } }, store);
  expect(managed).toMatchObject({ providerId: provider.id, model: 'fal-ai/luma-dream-machine', driver: { id: 'fal' } });
  const automatic = await resolveVideoExecution(settings, { driverId: 'mock', autoProvider: true, params: { prompt: 'fixture' } }, store);
  expect(automatic.providerId).toBe(provider.id);
  const legacy = await resolveVideoExecution(settings, { driverId: 'mock', params: { prompt: 'fixture' } }, store);
  expect(legacy.providerId).toBe('mock');
  await expect(resolveVideoExecution(settings, { driverId: 'unknown', params: { prompt: 'fixture' } }, store)).rejects.toThrow('不支持');
  await expect(resolveVideoExecution(settings, { driverId: provider.id, params: { prompt: 'fixture', model: 'fal-ai/../elsewhere' } }, store)).rejects.toThrow('完整');
  expect(provider.sampleParams.model).toBe('fal-ai/luma-dream-machine');
  provider.credentials.apiKey = '';
  await expect(resolveVideoExecution(settings, { driverId: 'mock', autoProvider: true, params: { prompt: 'fixture' } }, store)).rejects.toThrow('API Key');
  provider.enabled = false;
  await expect(resolveVideoExecution(settings, { driverId: 'mock', autoProvider: true, params: { prompt: 'fixture' } }, store)).rejects.toThrow('未启用');
  const missing = { ...store, getDefaultSelection: async () => ({ id: provider.id, configured: true }), getByIdWithSecret: async () => null } as ProviderStore;
  await expect(resolveVideoExecution(settings, { driverId: 'mock', autoProvider: true, params: { prompt: 'fixture' } }, missing)).rejects.toThrow('不存在');
  const untouched = { ...store, getDefaultSelection: async () => ({ configured: false }) } as ProviderStore;
  expect((await resolveVideoExecution(settings, { driverId: 'mock', autoProvider: true, params: { prompt: 'fixture' } }, untouched)).providerId).toBe('mock');
});
