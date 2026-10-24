import type { LocalSettings } from '../../shared/settings';
import type { ProviderCategory } from '../../shared/providerRegistry';
import { getProviderPreset } from '../../shared/providers';
import { DEFAULT_DRAFT_IMAGE_MODEL } from '../../shared/canvas';
import type { ProviderStore } from './storage/providerStore';
import { getAudioDriver, type AudioGenerateParams } from './canvas/audioDrivers';
import { getVideoDriver, type VideoGenerateParams, type VideoDriverOptions } from './canvas/videoDrivers';

export class ProviderResolutionError extends Error {
  readonly status = 400;
}
const clean = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
function supplied(value: string | undefined, label: string) {
  if (value !== undefined && !clean(value)) throw new ProviderResolutionError(`${label}不能为空`);
  return clean(value);
}

/** Resolve settings without writing or migrating the user's provider/model choices. */
export function resolveSettingsModel(settings: LocalSettings, request: {
  category: 'image' | 'llm'; providerId?: string; model?: string; draft?: boolean;
}) {
  const explicit = supplied(request.providerId, 'Provider');
  let providerId = explicit ?? clean(settings.activeProviderId) ?? 'openai';
  let stored = settings.providers?.[providerId];
  if (providerId === 'reizo-account' && !clean(stored?.apiKey)) throw new ProviderResolutionError('请先登录 Reizo 并刷新账号模型状态。');
  // Preserve the existing implicit image fallback; an explicit provider never silently changes.
  if (request.category === 'image' && !explicit && !clean(stored?.apiKey)) {
    for (const id of ['reizo', 'openai']) if (id !== providerId && clean(settings.providers?.[id]?.apiKey)) {
      providerId = id; stored = settings.providers[id]; break;
    }
  }
  const preset = getProviderPreset(providerId);
  if (!preset || !clean(stored?.apiKey)) throw new ProviderResolutionError(request.category === 'image'
    ? `请先在系统设置中配置 API Key（${preset?.name ?? providerId}）。`
    : `No API Key configured for ${preset?.name ?? providerId}. Add one in Settings.`);
  const baseUrl = clean(stored.baseUrl) ?? clean(preset.baseUrl);
  if (!baseUrl) throw new ProviderResolutionError('Provider is missing a base URL or model id.');
  let official = false;
  try { const url = new URL(baseUrl); official = url.hostname === 'api.openai.com'; if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
  catch { throw new ProviderResolutionError('Provider Base URL 无效'); }
  const requestedModel = supplied(request.model, '模型');
  const model = request.category === 'image'
    ? request.draft ? clean(settings.mediaModels?.draft) ?? DEFAULT_DRAFT_IMAGE_MODEL : requestedModel ?? clean(settings.mediaModels?.image) ?? (official ? 'dall-e-3' : 'gpt-image-2')
    : requestedModel ?? clean(stored.model) ?? clean(preset.defaultModel);
  if (!model) throw new ProviderResolutionError('Provider is missing a base URL or model id.');
  const catalogModel = providerId === 'reizo-account' ? settings.accountCatalog?.[request.category === 'image' ? 'image' : 'text'].find(item => item.id === model) : undefined;
  if (providerId === 'reizo-account' && settings.accountCatalog && !catalogModel) throw new ProviderResolutionError('当前账号没有此模型权限，请重新选择模型。');
  return { providerId, modelId: model, apiKey: stored.apiKey.trim(), baseUrl, protocol: catalogModel?.protocol };
}

export async function resolveManagedProvider(store: ProviderStore, category: ProviderCategory, providerId?: string) {
  let id = supplied(providerId, `${category} Provider`);
  if (!id) {
    const catalog = await store.getPublicCatalog(category);
    id = catalog.defaultProviderByCategory[category] ?? catalog.providers.find((provider) => provider.category === category && provider.enabled)?.id;
    if (!id) throw new ProviderResolutionError(`未配置可用的${category === 'audio' ? '音频' : category} Provider。`);
  }
  const provider = await store.getByIdWithSecret(id);
  if (!provider) throw new ProviderResolutionError(`指定的${category === 'audio' ? '音频' : category} Provider 不存在。`);
  if (provider.category !== category || !provider.enabled || !provider.id) throw new ProviderResolutionError(`所选 Provider 未启用或不支持${category === 'audio' ? '音频生成' : category}。`);
  return structuredClone(provider);
}

export async function resolveAudioProvider(store: ProviderStore, providerId?: string) {
  const provider = await resolveManagedProvider(store, 'audio', providerId);
  let driver: ReturnType<typeof getAudioDriver>;
  try { driver = getAudioDriver(provider.driverType); }
  catch { throw new ProviderResolutionError('音频 Provider 使用了不支持的驱动。'); }
  if (driver.id !== 'mock' && !clean(provider.credentials?.apiKey)) throw new ProviderResolutionError('音频 Provider 未配置 API Key。');
  return { provider, driver, modelFor: (params: AudioGenerateParams) => {
    const model = clean(driver.modelForRequest?.(params, provider.credentials)) ?? clean(params.model) ?? clean(driver.defaultModel);
    if (!model) throw new ProviderResolutionError('音频服务未配置生成模型。');
    return model;
  } };
}

export function resolveVideoProvider(settings: LocalSettings, request: {
  driverId: string; providerId?: string; submittedProviderId?: string; params: VideoGenerateParams; signal?: AbortSignal;
}) {
  const driverId = supplied(request.driverId, '视频驱动');
  const driver = getVideoDriver(driverId);
  if (driver.id !== driverId) throw new ProviderResolutionError(`不支持的视频驱动：${driverId}`);
  const requested = supplied(request.providerId, '视频 Provider');
  if (requested && requested !== driver.id && !settings.providers?.[requested] && !request.submittedProviderId)
    throw new ProviderResolutionError(`指定的视频 Provider 不存在：${requested}`);
  const providerId = clean(request.submittedProviderId) ?? (requested && settings.providers?.[requested] ? requested : driver.id);
  const stored = settings.providers?.[providerId];
  if (driver.id !== 'mock' && !clean(stored?.apiKey)) throw new ProviderResolutionError(`No video API key configured for ${providerId}`);
  const credentials: VideoDriverOptions = { apiKey: clean(stored?.apiKey), baseUrl: clean(stored?.baseUrl), signal: request.signal };
  const params = { ...request.params, model: supplied(request.params.model, '视频模型') ?? clean(settings.mediaModels?.video) };
  const model = clean(driver.modelForRequest?.(params, credentials)) ?? clean(params.model) ?? clean(driver.defaultModel) ?? driver.id;
  return { driver, providerId, credentials, params: { ...params, model }, model };
}

export async function resolveVideoExecution(settings: LocalSettings, request: {
  driverId: string; providerId?: string; submittedProviderId?: string; params: VideoGenerateParams; signal?: AbortSignal; autoProvider?: boolean; polling?: boolean;
}, store?: ProviderStore) {
  const selectedVideoModel = clean(request.params.model) ?? clean(settings.mediaModels?.video) ?? settings.accountCatalog?.video[0]?.id;
  const automaticAccountVideo = request.autoProvider && !request.providerId &&
    Boolean(settings.providers?.['reizo-account']?.apiKey && settings.accountCatalog?.video.some(model => model.id === selectedVideoModel));
  const useAccount = request.submittedProviderId === 'reizo-account' || !request.submittedProviderId &&
    (request.providerId === 'reizo-account' || request.autoProvider && settings.activeProviderId === 'reizo-account' || automaticAccountVideo);
  if (useAccount) {
    const stored = settings.providers?.['reizo-account'];
    if (!stored?.apiKey) throw new ProviderResolutionError('请先登录 Reizo 并刷新账号模型状态。');
    const id = supplied(request.params.model, '视频模型') ?? clean(settings.mediaModels?.video) ?? settings.accountCatalog?.video[0]?.id;
    if (!id) throw new ProviderResolutionError('视频任务缺少模型编号，请刷新模型列表后重新选择。');
    const model = settings.accountCatalog?.video.find(model => model.id === id);
    // A hidden model must not orphan an already accepted task. The gateway still authorizes every GET.
    const queryingAcceptedTask = request.polling && request.submittedProviderId === 'reizo-account' && request.driverId === 'new-api' && id;
    if (!model?.video && !queryingAcceptedTask) throw new ProviderResolutionError('当前账号没有此视频模型权限，请刷新模型列表后重新选择。');
    return { driver: getVideoDriver('new-api'), providerId: 'reizo-account', model: id,
      params: { ...request.params, model: id },
      credentials: { apiKey: stored.apiKey, baseUrl: stored.baseUrl, videoSupport: model?.video, signal: request.signal } as VideoDriverOptions };
  }
  let managedId = request.submittedProviderId;
  const legacyDriver = getVideoDriver(request.driverId);
  if (!managedId && legacyDriver.id !== request.driverId) managedId = request.driverId;
  if (!managedId && request.providerId && request.providerId !== legacyDriver.id) managedId = request.providerId;
  let provider = managedId && store ? await store.getByIdWithSecret(managedId) : undefined;
  if (!provider && request.autoProvider && !request.submittedProviderId && store) {
    const selection = typeof store.getDefaultSelection === 'function' ? await store.getDefaultSelection('video') :
      await store.getPublicCatalog('video').then((catalog) => ({ id: catalog.defaultProviderByCategory.video, configured: Boolean(catalog.defaultProviderByCategory.video) }));
    if (selection.configured) {
      if (!selection.id) throw new ProviderResolutionError('已保存的视频默认配置不可用，请重新选择 Provider。');
      provider = await resolveManagedProvider(store, 'video', selection.id);
      if (!provider.isDefault) throw new ProviderResolutionError('已保存的视频默认标记已变化，请重新选择 Provider。');
    }
  }
  if (!provider) return resolveVideoProvider(settings, request);
  if (!provider.enabled || provider.category !== 'video') throw new ProviderResolutionError('所选 Provider 未启用或不支持视频生成。');
  const driver = getVideoDriver(provider.driverType);
  if (driver.id !== provider.driverType) throw new ProviderResolutionError('视频 Provider 使用了不支持的驱动。');
  if (driver.id !== 'mock' && !clean(provider.credentials?.apiKey)) throw new ProviderResolutionError('视频 Provider 未配置 API Key。');
  const credentials: VideoDriverOptions = { apiKey: provider.credentials?.apiKey, baseUrl: provider.credentials?.baseUrl, signal: request.signal };
  const params = { ...request.params, model: supplied(request.params.model, '视频模型') ?? clean(provider.sampleParams?.model) ?? clean(settings.mediaModels?.video) };
  const model = clean(driver.modelForRequest?.(params, credentials)) ?? clean(params.model) ?? clean(driver.defaultModel) ?? driver.id;
  return { driver, providerId: provider.id, credentials, params: { ...params, model }, model };
}
