import { useState } from 'react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';
import SelectField, { type SelectOption } from '../ui/SelectField';
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from '../motion/popover-morph';
import { cn } from '../../lib/cn';

export default function ModelPicker({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const settings = useSettingsStore((s) => s.settings);
  const configured = settings.providers.filter((p) => p.hasKey || p.id === 'custom');
  const active = settings.providers.find((p) => p.id === settings.activeProviderId) ?? configured[0];

  if (!active) {
    return <span className="px-1 text-xs text-ink-muted">先在设置里添加 API Key</span>;
  }

  const providerOptions: SelectOption[] = settings.providers.map((p) => {
    const usable = p.hasKey || p.id === 'custom';
    return {
      value: p.id,
      label: p.name,
      disabled: !usable,
      hint: usable ? undefined : '未配置',
      dot: p.id === settings.activeProviderId ? 'accent' : undefined,
    };
  });

  const modelOptions: SelectOption[] = active.models.map((m) => ({ value: m.id, label: m.name }));
  if (active.model && !active.models.some((m) => m.id === active.model)) {
    modelOptions.push({ value: active.model, label: active.model });
  }

  const currentModelObj = active.models.find((m) => m.id === active.model);
  const currentModelLabel = currentModelObj?.name || active.model || active.name;

  if (compact) {
    return (
      <MorphPopover open={open} onOpenChange={setOpen}>
        <MorphPopoverTrigger>
          <button
            type="button"
            className="inline-flex h-7 max-w-[140px] items-center gap-1.5 rounded-lg bg-paper-inset/50 px-2 text-[12px] font-medium text-ink transition-colors hover:bg-paper-inset focus:outline-none"
            title={`供应商: ${active.name} · 模型: ${currentModelLabel}`}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-accent" />
            <span className="min-w-0 truncate">{currentModelLabel}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </MorphPopoverTrigger>

        <MorphPopoverContent
          side="top"
          align="start"
          sideOffset={8}
          radius={12}
          className="w-64 p-2 text-xs"
        >
          <div className="mb-2 border-b border-line/60 pb-2">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-ink-muted">
              <span>模型供应商</span>
              <span className="text-[10px] text-accent">已配置 {configured.length} 个</span>
            </div>
            <SelectField
              ariaLabel="模型供应商"
              value={active.id}
              options={providerOptions}
              onChange={(id) => void settingsStore.patchSettings({ activeProviderId: id })}
              className="w-full justify-between"
            />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-medium text-ink-muted">选择模型</div>
            {active.models.length > 0 ? (
              <div className="max-h-44 space-y-0.5 overflow-y-auto pr-0.5">
                {active.models.map((m) => {
                  const isSelected = m.id === active.model;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        void settingsStore.patchSettings({ provider: { id: active.id, model: m.id } });
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors',
                        isSelected
                          ? 'bg-accent/15 font-medium text-accent'
                          : 'text-ink hover:bg-paper-inset/70',
                      )}
                    >
                      <span className="truncate">{m.name}</span>
                      {isSelected && <Check size={13} className="shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                value={active.model}
                onChange={(e) =>
                  void settingsStore.patchSettings({ provider: { id: active.id, model: e.target.value } })
                }
                placeholder="输入模型 ID 并回车"
                aria-label="模型 id"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setOpen(false);
                }}
                className="w-full rounded-lg bg-paper-inset/60 px-2.5 py-1.5 text-[12px] text-ink outline-none hover:bg-paper-inset focus:bg-paper-inset"
              />
            )}
          </div>
        </MorphPopoverContent>
      </MorphPopover>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <SelectField
        ariaLabel="模型供应商"
        value={active.id}
        options={providerOptions}
        onChange={(id) => void settingsStore.patchSettings({ activeProviderId: id })}
        className="max-w-[150px]"
      />
      {active.models.length > 0 ? (
        <SelectField
          ariaLabel="模型"
          value={active.model}
          options={modelOptions}
          onChange={(model) => void settingsStore.patchSettings({ provider: { id: active.id, model } })}
          className="max-w-[170px]"
        />
      ) : (
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
