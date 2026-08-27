import { useState } from 'react';
import { Check, FolderOpen, KeyRound } from 'lucide-react';
import { cn } from '../lib/cn';
import { APP_NAME, APP_VERSION } from '../../shared/constants';
import type { Appearance, PermissionMode, PublicProvider } from '../../shared/settings';
import { useSettingsStore } from '../state/useSettingsStore';
import * as settingsStore from '../state/settingsStore';
import * as api from '../api';
import * as tabStore from '../state/tabStore';

type SectionId = 'general' | 'providers' | 'about';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'general', label: '通用' },
  { id: 'providers', label: '模型供应商' },
  { id: 'about', label: '关于' },
];

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>('providers');

  return (
    <div className="flex h-full min-w-0">
      <nav className="w-56 shrink-0 bg-sidebar px-3 py-6">
        <h2 className="mb-4 px-3 text-xl font-semibold tracking-tight">设置</h2>
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={cn(
              'relative w-full rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-paper-inset/70',
              section === id && 'bg-paper-inset/80 font-medium text-ink',
            )}
          >
            {section === id && (
              <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
            )}
            {label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto px-10 py-8">
        {section === 'general' && <GeneralSection />}
        {section === 'providers' && <ProvidersSection />}
        {section === 'about' && <AboutSection />}
      </div>
    </div>
  );
}

function GeneralSection() {
  const settings = useSettingsStore((s) => s.settings);
  const folderName = settings.workspacePath?.split(/[/\\]/).filter(Boolean).pop();

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">通用</h1>
      <p className="mb-8 text-sm text-ink-muted">
        外观和工作区。数据保存在本机。全局快捷键 Ctrl/⌘+Shift+Space 唤起窗口。
      </p>

      <h2 className="mb-3 text-sm font-medium">外观</h2>
      <div className="mb-8 flex gap-2">
        {([
          ['system', '跟随系统'],
          ['light', '浅色'],
          ['dark', '深色'],
        ] as [Appearance, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => void settingsStore.patchSettings({ appearance: id })}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm',
              settings.appearance === id ? 'bg-ink text-paper-raised' : 'bg-paper-inset text-ink hover:bg-paper-inset/80',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-medium">权限</h2>
      <p className="mb-3 text-xs text-ink-muted">写文件和跑命令前要不要先问你。</p>
      <div className="mb-8 flex flex-wrap gap-2">
        {([
          ['ask', '每次询问'],
          ['workspace', '工作区可写，命令仍询问'],
          ['full', '工作区内全部允许'],
        ] as [PermissionMode, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => void settingsStore.patchSettings({ permissionMode: id })}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm',
              settings.permissionMode === id ? 'bg-ink text-paper-raised' : 'bg-paper-inset text-ink hover:bg-paper-inset/80',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-medium">工作区</h2>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-paper px-3 py-2.5">
          <FolderOpen size={14} className="shrink-0 text-ink-muted" />
          <span className="truncate text-sm text-ink">{settings.workspacePath ?? '尚未绑定文件夹'}</span>
        </div>
        <button
          onClick={async () => {
            const path = await api.pickFolder();
            if (path) await settingsStore.patchSettings({ workspacePath: path });
          }}
          className="rounded-full bg-paper-inset px-3 py-2 text-sm text-ink hover:bg-paper-inset/80"
        >
          {folderName ? '更换' : '选择'}
        </button>
        {settings.workspacePath && (
          <button
            onClick={() => void settingsStore.patchSettings({ workspacePath: null })}
            className="text-sm text-danger"
          >
            清除
          </button>
        )}
      </div>
    </div>
  );
}

function ProvidersSection() {
  const settings = useSettingsStore((s) => s.settings);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">模型供应商</h1>
      <p className="mb-8 text-sm text-ink-muted">
        配置 API 密钥以使用不同的模型供应商。密钥经系统级加密后仅保存在本机。
      </p>
      <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
        {settings.providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ provider }: { provider: PublicProvider }) {
  const [keyInput, setKeyInput] = useState('');
  const [editing, setEditing] = useState(!provider.hasKey);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [customModel, setCustomModel] = useState(provider.model);

  async function handleSave() {
    if (provider.allowCustomBaseUrl) {
      await settingsStore.patchSettings({
        provider: {
          id: provider.id,
          apiKey: keyInput.trim() || undefined,
          baseUrl,
          model: customModel,
        },
        activeProviderId: provider.id,
      });
      setKeyInput('');
      setEditing(false);
      return;
    }
    if (!keyInput.trim()) return;
    await settingsStore.patchSettings({
      provider: { id: provider.id, apiKey: keyInput.trim() },
      activeProviderId: provider.id,
    });
    setKeyInput('');
    setEditing(false);
  }

  async function handleClear() {
    await settingsStore.patchSettings({ provider: { id: provider.id, apiKey: '' } });
    setEditing(true);
  }

  return (
    <div className="rounded-2xl border border-line bg-paper-raised p-5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-semibold">{provider.name}</h3>
        <span className="rounded bg-paper-inset px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
          {provider.tag}
        </span>
      </div>
      <p className="mb-4 text-xs text-ink-muted">
        {provider.description || provider.models[0]?.name || provider.model || '自定义模型'}
      </p>

      {provider.allowCustomBaseUrl && (
        <div className="mb-3 space-y-2">
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Base URL，例如 https://api.example.com/v1"
            className="w-full rounded-full bg-paper px-3 py-2 text-sm text-ink outline-none"
          />
          <input
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="模型 id"
            className="w-full rounded-full bg-paper px-3 py-2 text-sm text-ink outline-none"
          />
        </div>
      )}

      {provider.hasKey && !editing ? (
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-paper px-3 py-2.5">
            <KeyRound size={14} className="shrink-0 text-ink-muted" />
            <span className="flex-1 truncate text-sm tracking-[0.18em] text-ink">••••••••••••••••••••••••</span>
          </div>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
            <Check size={15} strokeWidth={2.5} />
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-full bg-paper px-3 py-2.5 focus-within:ring-1 focus-within:ring-accent">
          <KeyRound size={14} className="shrink-0 text-ink-muted" />
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
            placeholder={provider.id === 'reizo' ? '粘贴虚拟 sk-... 密钥' : '输入 API Key'}
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button
            onClick={() => void handleSave()}
            disabled={!provider.allowCustomBaseUrl && !keyInput.trim()}
            className="text-xs font-medium text-accent disabled:opacity-30"
          >
            保存
          </button>
        </div>
      )}

      {provider.hasKey && !editing && (
        <div className="mt-3 flex justify-end gap-3">
          <button onClick={() => setEditing(true)} className="text-xs text-ink-muted hover:text-ink">
            更换
          </button>
          <button onClick={() => void handleClear()} className="text-xs text-danger hover:opacity-80">
            移除
          </button>
        </div>
      )}
    </div>
  );
}

function AboutSection() {
  return (
    <div className="max-w-xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">关于</h1>
      <p className="mt-4 text-sm text-ink-muted">
        {APP_NAME} {APP_VERSION}
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        本地优先的桌面 Agent 工作台。会话、密钥和工作区都留在这台电脑上。
      </p>
      <button
        onClick={() => tabStore.newLauncherTab()}
        className="mt-6 text-sm text-accent hover:opacity-80"
      >
        返回对话
      </button>
    </div>
  );
}
