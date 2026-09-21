import { Bot, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';
import { useFavicon } from '../../lib/hooks/use-favicon';
import { MODEL_VENDOR_ICONS } from '../../lib/modelIcons';
import { cn } from '../../lib/cn';
import { modelVendorDomain } from '../../../shared/providers';
import { CANVAS_IMAGE_MODELS, CANVAS_VIDEO_MODELS } from '../../../shared/canvas';
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from '../motion/popover-morph';
import type { PublicProvider } from '../../../shared/settings';

type PickerTab = 'text' | 'image' | 'video';

// Accepts a bare domain ("openai.com") or a full URL — websiteUrl/baseUrl
// already carry a scheme, so wrapping blindly would produce "https://https://…".
function siteUrl(value: string) {
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

function ModelIcon({ domain, className }: { domain?: string; className?: string }) {
  const { src, ref } = useFavicon(domain ? siteUrl(domain) : undefined);
  const VendorIcon = domain ? MODEL_VENDOR_ICONS[domain] : undefined;
  if (VendorIcon) return <VendorIcon size={14} className={cn('shrink-0', className)} />;
  if (!src) return <Bot className={cn('size-3.5 shrink-0 text-ink-muted', className)} />;
  return (
    <img
      ref={ref}
      src={src}
      alt=""
      width={16}
      height={16}
      referrerPolicy="no-referrer"
      className={cn('size-4 shrink-0 rounded-sm object-contain', className)}
    />
  );
}

function ProviderIcon({ provider, className }: { provider: PublicProvider; className?: string }) {
  return <ModelIcon domain={provider.websiteUrl || provider.baseUrl} className={className} />;
}

function Row({
  icon,
  name,
  description,
  badge,
  selected,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  description?: string;
  badge?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors',
        'hover:bg-paper-inset focus-visible:bg-paper-inset disabled:pointer-events-none disabled:opacity-50',
        selected && 'bg-paper-inset',
      )}
    >
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] text-ink">
          <span className="truncate">{name}</span>
          {badge ? (
            <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {badge}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>
      {selected ? <Check className="mt-1 size-3.5 shrink-0 text-accent" /> : null}
    </button>
  );
}

const TABS: { id: PickerTab; label: string }[] = [
  { id: 'text', label: '文本' },
  { id: 'image', label: '图像' },
  { id: 'video', label: '视频' },
];

/**
 * Lovart-style model picker: a borderless trigger (vendor favicon + model name)
 * opening a tabbed panel — 文本 lists every provider's chat models, 图像/视频
 * pick the default generation model stored in settings.mediaModels.
 */
export default function ModelPicker({ compact = false }: { compact?: boolean }) {
  const settings = useSettingsStore((s) => s.settings);
  const [tab, setTab] = useState<PickerTab>('text');
  // Reizo (the built-in upstream) always shows; third-party vendors only once
  // they have a key. 'custom' stays for free-form endpoints.
  const configured = settings.providers.filter(
    (p) => p.hasKey || p.id === 'custom' || p.id === 'reizo',
  );
  const active = settings.providers.find((p) => p.id === settings.activeProviderId) ?? configured[0];

  if (!active) {
    return <span className="px-1 text-xs text-ink-muted">先在设置里添加 API Key</span>;
  }

  const currentModelObj = active.models.find((m) => m.id === active.model);
  const currentModelLabel = currentModelObj?.name || active.model || active.name;

  function pickText(combined: string) {
    const [providerId, modelId] = combined.split('::');
    const provider = settings.providers.find((p) => p.id === providerId);
    if (!provider) return;
    // '__custom' keeps whatever model string the provider already has —
    // free-form providers (e.g. id 'custom') carry no preset model list.
    const model = modelId === '__custom' ? provider.model : modelId;
    void settingsStore.patchSettings({
      activeProviderId: providerId,
      provider: { id: providerId, model },
    });
  }

  function pickMedia(kind: 'image' | 'video', modelId: string) {
    void settingsStore.patchSettings({ mediaModels: { [kind]: modelId } });
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <MorphPopover>
        <MorphPopoverTrigger>
          <button
            type="button"
            aria-label="模型"
            title={`供应商: ${active.name} · 模型: ${currentModelLabel}`}
            className={cn(
              'flex w-auto min-w-0 items-center gap-1.5 rounded-xl px-2 text-xs text-ink-muted outline-none transition-colors',
              'hover:bg-paper-inset/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30',
              compact ? 'h-7 max-w-[140px] text-[12px]' : 'h-8 max-w-52 py-0',
            )}
          >
            <ModelIcon domain={modelVendorDomain(active.model) || active.websiteUrl || active.baseUrl} />
            <span className="truncate">{currentModelLabel}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </button>
        </MorphPopoverTrigger>
        <MorphPopoverContent side="top" align="start" sideOffset={8} radius={14} className="w-72">
          {/* Tab strip — modal category like Lovart's picker */}
          <div className="flex gap-0.5 rounded-lg bg-paper-inset/60 p-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-xs transition-colors',
                  tab === t.id
                    ? 'bg-paper-raised font-medium text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-1.5 max-h-72 overflow-y-auto">
            {tab === 'text' &&
              // Only configured providers — an unconfigured provider's models
              // can't be called anyway, and the list stays clean.
              configured.map((p) => {
                const items = p.models.length
                  ? p.models
                  : [{ id: '__custom', name: p.model || '自定义模型' }];
                return (
                  <div key={p.id}>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-ink-muted">
                      <ProviderIcon provider={p} className="size-3" />
                      {p.name}
                    </div>
                    {items.map((m) => (
                      <Row
                        key={m.id}
                        icon={<ModelIcon domain={modelVendorDomain(m.id)} />}
                        name={m.name}
                        selected={p.id === active.id && (m.id === active.model || m.id === '__custom')}
                        onClick={() => pickText(`${p.id}::${m.id}`)}
                      />
                    ))}
                  </div>
                );
              })}

            {tab === 'image' &&
              CANVAS_IMAGE_MODELS.map((m) => (
                <Row
                  key={m.id}
                  icon={<ModelIcon domain={modelVendorDomain(m.id)} />}
                  name={m.name}
                  description={m.description}
                  badge={m.badge}
                  selected={settings.mediaModels?.image === m.id}
                  onClick={() => pickMedia('image', m.id)}
                />
              ))}

            {tab === 'video' &&
              CANVAS_VIDEO_MODELS.map((m) => (
                <Row
                  key={m.id}
                  icon={<ModelIcon domain={modelVendorDomain(m.id)} />}
                  name={m.name}
                  badge={m.badge}
                  selected={settings.mediaModels?.video === m.id}
                  onClick={() => pickMedia('video', m.id)}
                />
              ))}
          </div>
        </MorphPopoverContent>
      </MorphPopover>
      {/* Providers without preset models still need a free-form model id input. */}
      {active.models.length === 0 && (
        <input
          value={active.model}
          onChange={(e) =>
            void settingsStore.patchSettings({ provider: { id: active.id, model: e.target.value } })
          }
          placeholder="模型 id"
          aria-label="模型 id"
          className="w-32 rounded-lg bg-transparent px-2.5 py-1.5 text-[13px] text-ink transition-colors duration-[140ms] outline-none placeholder:text-ink-muted hover:bg-paper-inset/60 focus:bg-paper-inset"
        />
      )}
    </div>
  );
}
