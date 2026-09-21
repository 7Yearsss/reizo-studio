import { Bot } from 'lucide-react';
import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '../ui/select';
import { useFavicon } from '../../lib/hooks/use-favicon';
import { cn } from '../../lib/cn';
import type { PublicProvider } from '../../../shared/settings';

function ProviderIcon({ provider, className }: { provider: PublicProvider; className?: string }) {
  const { src, ref } = useFavicon(provider.websiteUrl || provider.baseUrl || undefined);
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

/**
 * Single borderless model select (beui prompt-input style): provider favicon +
 * current model on the trigger; the dropdown groups every preset's models under
 * its provider so switching provider and model is one pick.
 */
export default function ModelPicker({ compact = false }: { compact?: boolean }) {
  const settings = useSettingsStore((s) => s.settings);
  const configured = settings.providers.filter((p) => p.hasKey || p.id === 'custom');
  const active = settings.providers.find((p) => p.id === settings.activeProviderId) ?? configured[0];

  if (!active) {
    return <span className="px-1 text-xs text-ink-muted">先在设置里添加 API Key</span>;
  }

  const currentModelObj = active.models.find((m) => m.id === active.model);
  const currentModelLabel = currentModelObj?.name || active.model || active.name;

  function pick(combined: string) {
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

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Select value={`${active.id}::${active.models.length ? active.model : '__custom'}`} onValueChange={pick}>
        <SelectTrigger
          aria-label="模型"
          className={cn(
            'w-auto rounded-xl border-0 bg-transparent px-2 text-xs shadow-none hover:bg-paper-inset/60 focus-visible:ring-2 data-[state=open]:bg-paper-inset',
            compact ? 'h-7 max-w-[140px] text-[12px]' : 'h-8 max-w-52 py-0',
          )}
          title={`供应商: ${active.name} · 模型: ${currentModelLabel}`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ProviderIcon provider={active} />
            <span className="truncate text-ink-muted">{currentModelLabel}</span>
          </span>
        </SelectTrigger>
        <SelectContent className="w-64">
          {settings.providers.map((p) => {
            const usable = p.hasKey || p.id === 'custom';
            const items = p.models.length
              ? p.models
              : [{ id: '__custom', name: p.model || '自定义模型' }];
            return (
              <SelectGroup key={p.id}>
                <SelectLabel className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <ProviderIcon provider={p} className="size-3" />
                  {p.name}
                  {!usable && <span className="text-[10px]">· 未配置</span>}
                </SelectLabel>
                {items.map((m) => (
                  <SelectItem key={m.id} value={`${p.id}::${m.id}`} disabled={!usable}>
                    <span className="min-w-0 truncate text-[13px]">{m.name}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
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
