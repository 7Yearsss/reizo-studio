import { modelVendorDomain } from '../../shared/providers';
import type { PublicSettings } from '../../shared/settings';

/** Video choices belong to the media catalog, independently of the chat model. */
export function videoCatalogProvider(settings: Pick<PublicSettings, 'providers' | 'activeProviderId'>) {
  const active = settings.providers.find(provider => provider.id === settings.activeProviderId);
  if (active?.id === 'reizo-account' || active?.catalog) return active;
  return settings.providers.find(provider => provider.id === 'reizo-account' && provider.hasKey && provider.catalog) ?? active;
}

export interface ModelOption {
  value: string;
  id: string;
  name: string;
  description?: string;
  badge?: string;
  source?: string;
}

const VENDORS: Record<string, string> = {
  'openai.com': 'OpenAI',
  'anthropic.com': 'Anthropic',
  'deepmind.google': 'Google',
  'deepseek.com': 'DeepSeek',
  'x.ai': 'xAI',
  'minimax.io': 'MiniMax',
  'www.aliyun.com': '阿里云 · 通义',
  'moonshot.cn': 'Moonshot AI',
  'bigmodel.cn': '智谱 AI',
  'mistral.ai': 'Mistral AI',
  'www.llama.com': 'Meta',
  'bfl.ai': 'Black Forest Labs',
  'www.midjourney.com': 'Midjourney',
  'klingai.com': '快手 · 可灵',
  'lumalabs.ai': 'Luma AI',
  'stability.ai': 'Stability AI',
};

export function groupModels(options: readonly ModelOption[], query = '') {
  const groups = new Map<string, { id: string; name: string; domain?: string; models: ModelOption[] }>();
  const needle = query.trim().toLowerCase();
  for (const model of options) {
    const domain = modelVendorDomain(model.id);
    const id = domain ?? 'other';
    const name = domain ? VENDORS[domain] ?? domain : '其他模型';
    if (needle && !`${name} ${model.id} ${model.name} ${model.source ?? ''}`.toLowerCase().includes(needle)) continue;
    if (!groups.has(id)) groups.set(id, { id, name, domain, models: [] });
    groups.get(id)?.models.push(model);
  }
  const order = [...Object.keys(VENDORS), 'other'];
  return [...groups.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
