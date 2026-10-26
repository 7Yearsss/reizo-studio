import type { AskQuestion } from '../../../shared/stream';
import type { LocalSettings } from '../../../shared/settings';
import type { VideoModelSupport } from '../../../shared/modelCatalog';
import type { ProviderStore } from '../storage/providerStore';
import { getVideoDriver } from '../canvas/videoDrivers';

export interface VideoModelOption {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  label: string;
  support?: VideoModelSupport;
}

/** Same configured sources as the executor, with no credentials in the returned choices. */
export async function videoModelOptions(settings: LocalSettings, providerStore?: ProviderStore) {
  const models: VideoModelOption[] = [];
  let defaultProviderId: string | undefined;
  let defaultModel = settings.mediaModels?.video;
  if (settings.providers?.['reizo-account']?.apiKey) {
    if (settings.activeProviderId === 'reizo-account') defaultProviderId = 'reizo-account';
    for (const item of settings.accountCatalog?.video ?? []) {
      if (!item.video) continue;
      models.push({ id: item.id, name: item.name, providerId: 'reizo-account', providerName: 'Reizo 账号',
        label: `${item.name} · Reizo 账号`, support: item.video });
    }
  }
  const catalog = await providerStore?.getPublicCatalog('video');
  defaultProviderId ??= catalog?.defaultProviderByCategory.video;
  for (const provider of catalog?.providers ?? []) {
    const driver = getVideoDriver(provider.driverType);
    if (provider.category !== 'video' || !provider.enabled || !provider.hasKey || driver.id !== provider.driverType || driver.id === 'mock') continue;
    const sampleModel = (typeof provider.sampleParams.model === 'string' ? provider.sampleParams.model.trim() : undefined) || driver.defaultModel;
    const available = provider.availableModels.length ? provider.availableModels : sampleModel ? [{ id: sampleModel, name: sampleModel }] : [];
    for (const item of available) {
      if (!item.id.trim()) continue;
      models.push({ id: item.id, name: item.name, providerId: provider.id, providerName: provider.name,
        label: `${item.name} · ${provider.name}` });
    }
    if (provider.id === defaultProviderId && sampleModel && !defaultModel) defaultModel = sampleModel;
  }
  // Legacy driver credentials remain supported without inventing a static model catalog.
  for (const providerId of ['kling', 'fal']) {
    if (models.some(item => item.providerId === providerId) || !settings.providers?.[providerId]?.apiKey) continue;
    const driver = getVideoDriver(providerId);
    const id = settings.mediaModels?.video || driver.defaultModel;
    if (id) models.push({ id, name: id, providerId, providerName: driver.name, label: `${id} · ${driver.name}` });
  }
  const selected = models.find(item => item.providerId === defaultProviderId && item.id === defaultModel) ??
    models.find(item => item.providerId === defaultProviderId) ?? models.find(item => item.id === defaultModel) ??
    models.find(item => item.providerId === 'reizo-account') ?? models[0];
  const question: AskQuestion | undefined = models.length ? {
    id: 'video_model', kind: 'choice', prompt: '这次视频使用哪个模型？',
    options: models.map(item => item.label), ...(selected ? { recommended: selected.label } : {}),
  } : undefined;
  return { models, selected, question };
}
