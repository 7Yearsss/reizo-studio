import { useSettingsStore } from '../../state/useSettingsStore';
import * as settingsStore from '../../state/settingsStore';

export default function ModelPicker() {
  const settings = useSettingsStore((s) => s.settings);
  const configured = settings.providers.filter((p) => p.hasKey || p.id === 'custom');
  const active = settings.providers.find((p) => p.id === settings.activeProviderId) ?? configured[0];

  if (!active) {
    return <span className="text-xs text-ink-muted">先在设置里添加 API Key</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <select
        value={active.id}
        onChange={(e) => void settingsStore.patchSettings({ activeProviderId: e.target.value })}
        className="max-w-[140px] truncate rounded-full bg-paper px-2 py-1 text-xs text-ink outline-none"
      >
        {settings.providers.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.hasKey && p.id !== 'custom'}>
            {p.name}
            {!p.hasKey && p.id !== 'custom' ? ' · 未配置' : ''}
          </option>
        ))}
      </select>
      {active.models.length > 0 ? (
        <select
          value={active.model}
          onChange={(e) =>
            void settingsStore.patchSettings({ provider: { id: active.id, model: e.target.value } })
          }
          className="max-w-[160px] truncate rounded-full bg-paper px-2 py-1 text-xs text-ink outline-none"
        >
          {active.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          {active.model && !active.models.some((m) => m.id === active.model) && (
            <option value={active.model}>{active.model}</option>
          )}
        </select>
      ) : (
        <input
          value={active.model}
          onChange={(e) =>
            void settingsStore.patchSettings({ provider: { id: active.id, model: e.target.value } })
          }
          placeholder="模型 id"
          className="w-28 rounded-full bg-paper px-2 py-1 text-xs text-ink outline-none"
        />
      )}
    </div>
  );
}
