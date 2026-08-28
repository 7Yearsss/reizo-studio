import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';
import SelectField, { type SelectOption } from '../ui/SelectField';

export default function ModelPicker() {
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
