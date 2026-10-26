import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { EMPTY_SHORTLIST, parseShortlist, recordPick, shortlistOptions, toggleFavorite, type ModelShortlist } from '../../../shared/modelShortlist';
import { Popover } from 'radix-ui';
import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';
import { cn } from '../../lib/cn';
import { modelVendorDomain } from '../../../shared/providers';
import { CANVAS_IMAGE_MODELS, CANVAS_VIDEO_MODELS } from '../../../shared/canvas';
import { mediaCatalogProvider, type ModelOption } from '../../lib/modelCatalog';
import ModelIcon from '../models/ModelIcon';
import ModelList from '../models/ModelList';
import { MODEL_POPOVER_CLASS } from '../models/ModelSelect';

type PickerTab = 'text' | 'image' | 'video';
const TABS: { id: PickerTab; label: string }[] = [
  { id: 'text', label: '文本' }, { id: 'image', label: '图像' }, { id: 'video', label: '视频' },
];

const SHORTLIST_KEY = 'reizo:model-shortlist';
function loadShortlist(tab: PickerTab): ModelShortlist {
  try {
    return parseShortlist(JSON.parse(localStorage.getItem(SHORTLIST_KEY) ?? '{}')[tab]);
  } catch {
    return EMPTY_SHORTLIST;
  }
}
function saveShortlist(tab: PickerTab, list: ModelShortlist): void {
  try {
    const all = JSON.parse(localStorage.getItem(SHORTLIST_KEY) ?? '{}');
    localStorage.setItem(SHORTLIST_KEY, JSON.stringify({ ...all, [tab]: list }));
  } catch { /* a per-viewer convenience; losing it is fine */ }
}

export default function ModelPicker({ compact = false }: { compact?: boolean }) {
  const settings = useSettingsStore((s) => s.settings);
  const [tab, setTab] = useState<PickerTab>('text');
  const [open, setOpen] = useState(false);
  const [shortlists, setShortlists] = useState<Record<PickerTab, ModelShortlist>>(() => ({ text: loadShortlist('text'), image: loadShortlist('image'), video: loadShortlist('video') }));
  const connected = settings.providers.filter((provider) => provider.hasKey);
  const configured = connected.length ? connected : settings.providers.filter((provider) => provider.id === 'custom' || provider.id === 'reizo');
  const active = settings.providers.find((p) => p.id === settings.activeProviderId) ?? configured[0];
  if (!active) return <span className="px-1 text-xs text-ink-muted">先在设置里添加 API Key</span>;

  const currentModel = active.models.find((model) => model.id === active.model);
  const label = active.id === 'reizo-account' && !active.models.length ? '暂无文本模型' : currentModel?.name || active.model || active.name;
  const textOptions = configured.flatMap((provider) => {
    const models = provider.models.length || provider.id === 'reizo-account' ? provider.models : [{ id: provider.model || '__custom', name: provider.model || '自定义模型' }];
    return models.map((model) => ({ ...model, value: JSON.stringify([provider.id, model.id]), providerId: provider.id,
      source: configured.length > 1 ? provider.name : undefined }));
  });
  const mediaProvider = mediaCatalogProvider(settings) ?? active;
  const mediaModels = mediaProvider.catalog ? mediaProvider.catalog[tab === 'video' ? 'video' : 'image'] : mediaProvider.id === 'reizo-account' ? [] : tab === 'image' ? CANVAS_IMAGE_MODELS : CANVAS_VIDEO_MODELS;
  const options: ModelOption[] = tab === 'text' ? textOptions : mediaModels.map((model) => ({ ...model, value: model.id }));
  const selectedValue = tab === 'text' ? JSON.stringify([active.id, active.model || '__custom']) : settings.mediaModels?.[tab];

  function updateShortlist(next: ModelShortlist) {
    setShortlists((previous) => ({ ...previous, [tab]: next }));
    saveShortlist(tab, next);
  }

  function pick(option: ModelOption) {
    updateShortlist(recordPick(shortlists[tab], option.value));
    if (tab === 'text') {
      const selected = textOptions.find((model) => model.value === option.value);
      if (!selected) return;
      const provider = configured.find((p) => p.id === selected.providerId);
      if (!provider) return;
      void settingsStore.patchSettings({ activeProviderId: provider.id, provider: { id: provider.id, model: selected.id === '__custom' ? provider.model : selected.id } });
    } else {
      void settingsStore.patchSettings({ mediaModels: { [tab]: option.id } });
    }
    setOpen(false);
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" aria-label="模型" title={`供应商: ${active.name} · 模型: ${label}`}
            className={cn('flex w-auto min-w-0 items-center gap-1.5 rounded-xl px-2 text-xs text-ink-muted outline-none transition-colors hover:bg-paper-inset/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30', compact ? 'h-7 max-w-[140px] text-[12px]' : 'h-8 max-w-52 py-0')}>
            <ModelIcon domain={modelVendorDomain(active.model) || active.websiteUrl || active.baseUrl} />
            <span className="truncate">{label}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="切换模型" className={cn(MODEL_POPOVER_CLASS, 'w-[360px]')}>
            <div aria-label="模型类型" className="mx-3 mt-3 flex shrink-0 gap-1 rounded-lg bg-paper-inset/70 p-1">
              {TABS.map((item) => <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}
                className={cn('flex-1 rounded-md px-2 py-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/25', tab === item.id ? 'bg-paper-raised font-medium text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}>{item.label}</button>)}
            </div>
            <ModelList key={tab} options={options} value={selectedValue} onSelect={pick} {...shortlistOptions(shortlists[tab], options)} favoriteValues={shortlists[tab].favorites} onToggleFavorite={(option) => updateShortlist(toggleFavorite(shortlists[tab], option.value))} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {active.models.length === 0 && active.id !== 'reizo-account' && <input value={active.model} onChange={(event) => void settingsStore.patchSettings({ provider: { id: active.id, model: event.target.value } })}
        placeholder="模型 id" aria-label="模型 id" className="w-32 rounded-lg bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted hover:bg-paper-inset/60 focus:bg-paper-inset" />}
    </div>
  );
}
