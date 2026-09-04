import { useState } from 'react';
import { Check, FolderOpen, KeyRound } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { APP_NAME, APP_VERSION } from '../../shared/constants';
import type { Appearance, PermissionMode, PublicProvider } from '../../shared/settings';
import { useSettingsStore } from '../state/useSettingsStore';
import * as settingsStore from '../state/settingsStore';
import * as api from '../api';
import * as tabStore from '../state/tabStore';
import * as uiStore from '../state/uiStore';
import { toast } from '../lib/toast';
import { StatefulButton, type ButtonState } from '../components/motion/button/stateful';
import { Input } from '../components/motion/input';

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
              'relative w-full rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150',
              section === id ? 'font-medium text-ink' : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
            )}
          >
            {section === id && (
              <motion.span
                layoutId="settings-nav-active"
                className="absolute inset-0 rounded-lg bg-paper-inset/80"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            )}
            {section === id && (
              <motion.span
                layoutId="settings-nav-indicator"
                className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            )}
            <span className="relative z-10">{label}</span>
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
        外观和工作区。数据保存在本机。全局快捷键 Ctrl/⌘+K 呼出命令面板。
      </p>

      <h2 className="mb-3 text-sm font-medium">外观</h2>
      <div className="mb-8 flex gap-2">
        {([
          ['system', '跟随系统'],
          ['light', '浅色'],
          ['dark', '深色'],
        ] as [Appearance, string][]).map(([id, label]) => {
          const active = settings.appearance === id;
          return (
            <button
              key={id}
              onClick={() => void settingsStore.patchSettings({ appearance: id })}
              className={cn(
                'relative rounded-full px-4 py-1.5 text-sm transition-colors duration-150',
                active ? 'font-medium text-paper-raised' : 'text-ink hover:bg-paper-inset/80',
              )}
            >
              {active && (
                <motion.span
                  layoutId="appearance-active"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
      </div>

      <h2 className="mb-3 text-sm font-medium">权限</h2>
      <p className="mb-3 text-xs text-ink-muted">写文件和跑命令前要不要先问你。</p>
      <div className="mb-8 flex flex-wrap gap-2">
        {([
          ['ask', '每次询问'],
          ['workspace', '工作区可写，命令仍询问'],
          ['full', '工作区内全部允许'],
        ] as [PermissionMode, string][]).map(([id, label]) => {
          const active = settings.permissionMode === id;
          return (
            <button
              key={id}
              onClick={() => void settingsStore.patchSettings({ permissionMode: id })}
              className={cn(
                'relative rounded-full px-4 py-1.5 text-sm transition-colors duration-150',
                active ? 'font-medium text-paper-raised' : 'text-ink hover:bg-paper-inset/80',
              )}
            >
              {active && (
                <motion.span
                  layoutId="permission-active"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
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
            if (path) {
              await settingsStore.patchSettings({ workspacePath: path });
              toast.success('工作区已更新');
            }
          }}
          className="rounded-full bg-paper-inset px-3 py-2 text-sm text-ink hover:bg-paper-inset/80"
        >
          {folderName ? '更换' : '选择'}
        </button>
        {settings.workspacePath && (
          <button
            onClick={() => {
              void settingsStore.patchSettings({ workspacePath: null });
              toast.info('已清除工作区绑定');
            }}
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
  const [saveState, setSaveState] = useState<ButtonState>('idle');

  async function handleSave() {
    setSaveState('loading');
    try {
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
        setSaveState('success');
        toast.success(`${provider.name} 配置已保存`);
        setTimeout(() => setSaveState('idle'), 2000);
        return;
      }
      if (!keyInput.trim()) {
        setSaveState('idle');
        return;
      }
      await settingsStore.patchSettings({
        provider: { id: provider.id, apiKey: keyInput.trim() },
        activeProviderId: provider.id,
      });
      setKeyInput('');
      setEditing(false);
      setSaveState('success');
      toast.success(`${provider.name} 密钥已保存`);
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      toast.error('保存失败，请检查配置');
      setTimeout(() => setSaveState('idle'), 2500);
    }
  }

  async function handleClear() {
    await settingsStore.patchSettings({ provider: { id: provider.id, apiKey: '' } });
    setEditing(true);
    toast.info(`${provider.name} 密钥已移除`);
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
          <Input
            value={baseUrl}
            onChange={(val) => setBaseUrl(val)}
            placeholder="Base URL，例如 https://api.example.com/v1"
            className="w-full text-xs"
          />
          <Input
            value={customModel}
            onChange={(val) => setCustomModel(val)}
            placeholder="模型 ID，例如 deepseek-chat"
            className="w-full text-xs"
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
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Input
              type="password"
              value={keyInput}
              onChange={(val) => setKeyInput(val)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
              }}
              placeholder={provider.id === 'reizo' ? '粘贴虚拟 sk-... 密钥' : '输入 API Key'}
              leftIcon={<KeyRound size={14} className="text-ink-muted" />}
              className="w-full text-sm"
            />
          </div>
          <StatefulButton
            state={saveState}
            onClick={() => void handleSave()}
            disabled={!provider.allowCustomBaseUrl && !keyInput.trim()}
            size="sm"
            className="shrink-0"
          >
            保存
          </StatefulButton>
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
        onClick={() => {
          uiStore.setMode('chat');
          tabStore.newLauncherTab();
        }}
        className="mt-6 text-sm text-accent hover:opacity-80"
      >
        返回对话
      </button>
    </div>
  );
}
