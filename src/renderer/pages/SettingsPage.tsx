import { Brain, FolderOpen, Settings2, Sparkles, ChartNoAxesCombined, Database, Info, Blocks } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { APP_NAME, APP_VERSION } from '../../shared/constants';
import type { Appearance, BusyEnterBehavior, PermissionMode, ReasoningEffort } from '../../shared/settings';
import { useSettingsStore } from '../state/useSettingsStore';
import * as settingsStore from '../state/settingsStore';
import * as api from '../api';
import * as uiStore from '../state/uiStore';
import { useUiStore } from '../state/useUiStore';
import { toast } from '../lib/toast';
import ProvidersSection from './settings/ProvidersSection';
import StorageMaintenanceSection from './settings/StorageMaintenanceSection';
import UsageCostsSection from './settings/UsageCostsSection';
import ExtensionsSection from './settings/ExtensionsSection';
import MemorySection from './settings/MemorySection';
import HarnessLessonsSection from './settings/HarnessLessonsSection';

type SectionId = uiStore.SettingsSection;

const SECTIONS: { id: SectionId; label: string; icon: typeof Settings2 }[] = [
  { id: 'general', label: '通用', icon: Settings2 },
  { id: 'providers', label: '模型', icon: Sparkles },
  { id: 'memory', label: '记忆', icon: Brain },
  { id: 'extensions', label: '扩展', icon: Blocks },
  { id: 'usage', label: '用量与费用', icon: ChartNoAxesCombined },
  { id: 'storage', label: '存储', icon: Database },
  { id: 'about', label: '关于', icon: Info },
];

export default function SettingsPage() {
  const section = useUiStore((state) => SECTIONS.some(item => item.id === state.settingsSection) ? state.settingsSection : 'providers');
  const setSection = (next: SectionId) => uiStore.openSettings(next);

  return (
    <div className="flex h-full min-w-0 max-sm:flex-col">
      <nav aria-label="设置分类" className="w-44 shrink-0 overflow-y-auto border-r border-line bg-sidebar px-3 py-6 max-sm:w-full max-sm:border-b max-sm:border-r-0 max-sm:py-3">
        <h2 className="mb-5 px-3 text-sm font-semibold text-ink-muted max-sm:mb-2">设置</h2>
        <div className="space-y-1 max-sm:flex max-sm:gap-1 max-sm:space-y-0 max-sm:overflow-x-auto">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            aria-current={section === id ? 'page' : undefined}
            className={cn(
              'relative w-full shrink-0 rounded-xl px-3 py-2.5 text-left text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent max-sm:w-auto',
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
            <span className="relative z-10 flex items-center gap-3 whitespace-nowrap"><Icon size={16} />{label}</span>
          </button>
        ))}
        </div>
      </nav>
      <div className={cn("min-h-0 min-w-0 flex-1 pl-6 pr-16 pb-5 pt-7 max-sm:px-4 max-sm:pt-4", section === 'providers' ? 'overflow-hidden' : 'overflow-y-auto')}>
        {section === 'general' && <GeneralSection />}
        {section === 'providers' && <ProvidersSection />}
        {section === 'memory' && <MemorySection />}
        {section === 'extensions' && <ExtensionsSection />}
        {section === 'usage' && <UsageCostsSection onOpenProviders={() => setSection('providers')} />}
        {section === 'storage' && <StorageMaintenanceSection />}
        {section === 'about' && <AboutSection />}
      </div>
    </div>
  );
}

function SettingGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section aria-label={title} className="rounded-xl border border-line bg-paper-raised p-4 sm:p-5">
    <h2 className="text-sm font-medium">{title}</h2>
    {description ? <p className="mt-2 text-xs leading-relaxed text-ink-muted">{description}</p> : null}
    <div className="mt-3">{children}</div>
  </section>;
}

function PersonalRulesEditor() {
  const [text, setText] = useState('');
  const [max, setMax] = useState(2000);
  const [loaded, setLoaded] = useState(false);
  const saved = useRef('');
  useEffect(() => {
    void api.getPersonalRules().then((r) => { setText(r.text); saved.current = r.text; setMax(r.maxChars); setLoaded(true); }, () => setLoaded(true));
  }, []);
  const save = () => {
    if (!loaded || text === saved.current) return;
    void api.savePersonalRules(text).then(() => { saved.current = text; toast.success('已保存'); }, () => toast.error('保存失败'));
  };
  return (
    <div>
      <textarea
        aria-label="个人偏好"
        value={text}
        maxLength={max}
        rows={5}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        placeholder={'例如：回答先给结论；称呼我「老板」；表格金额一律保留两位小数；邮件用正式语气。'}
        className="w-full resize-y rounded-2xl bg-paper-inset px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p className="mt-1 text-right text-[11px] text-ink-muted">{text.length}/{max}</p>
    </div>
  );
}

function GeneralSection() {
  const settings = useSettingsStore((s) => s.settings);
  const folderName = settings.workspacePath?.split(/[/\\]/).filter(Boolean).pop();

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">通用</h1>
      <p className="mb-5 text-sm text-ink-muted">
        外观和工作区。数据保存在本机。全局快捷键 Ctrl/⌘+K 呼出命令面板。
      </p>

      <div className="space-y-4">
      <SettingGroup title="外观">
      <div className="flex flex-wrap gap-2">
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
      </SettingGroup>

      <SettingGroup title="个人偏好" description="语气、称呼、回复风格、你的行业习惯。对所有项目生效，每轮对话都会参考。">
        <PersonalRulesEditor />
      </SettingGroup>

      <SettingGroup title="权限" description="写文件和跑命令前要不要先问你。">
      <div className="flex flex-wrap gap-2">
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
      </SettingGroup>

      <SettingGroup title="电脑操作 (Computer Use)" description="允许 Agent 截屏并控制这台电脑的鼠标、键盘。仅在需要操作图形界面时使用；每个会话首次操作前会向你确认一次。">
      <div className="flex flex-wrap gap-2">
        {([
          [false, '关闭'],
          [true, '开启'],
        ] as [boolean, string][]).map(([value, label]) => {
          const active = settings.computerUse === value;
          return (
            <button
              key={String(value)}
              onClick={() => void settingsStore.patchSettings({ computerUse: value })}
              className={cn(
                'relative rounded-full px-4 py-1.5 text-sm transition-colors duration-150',
                active ? 'font-medium text-paper-raised' : 'text-ink hover:bg-paper-inset/80',
              )}
            >
              {active && (
                <motion.span
                  layoutId="computer-use-active"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
      </div>
      </SettingGroup>

      <SettingGroup title="对话" description="Agent 回复中按 Enter 时：排队等这条回复完，或直接插话进当前这轮（Ctrl+Enter 始终是另一种）。">
      <div className="flex flex-wrap gap-2">
        {([
          ['queue', '排队发送'],
          ['steer', '直接插话'],
        ] as [BusyEnterBehavior, string][]).map(([id, label]) => {
          const active = settings.busyEnter === id;
          return (
            <button
              key={id}
              onClick={() => void settingsStore.patchSettings({ busyEnter: id })}
              className={cn(
                'relative rounded-full px-4 py-1.5 text-sm transition-colors duration-150',
                active ? 'font-medium text-paper-raised' : 'text-ink hover:bg-paper-inset/80',
              )}
            >
              {active && (
                <motion.span
                  layoutId="busy-enter-active"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
      </div>
      </SettingGroup>

      <SettingGroup title="思考力度" description="推理模型回答前“想”多少——低档一句话问题 ~3s 出答，高档适合复杂任务但更慢（默认档最慢可达 90s）。">
      <div className="flex flex-wrap gap-2">
        {([
          ['low', '低 · 快'],
          ['medium', '中'],
          ['high', '高'],
          [null, '模型默认'],
        ] as [ReasoningEffort | null, string][]).map(([id, label]) => {
          const active = settings.reasoningEffort === id;
          return (
            <button
              key={id ?? 'auto'}
              onClick={() => void settingsStore.patchSettings({ reasoningEffort: id })}
              className={cn(
                'relative rounded-full px-4 py-1.5 text-sm transition-colors duration-150',
                active ? 'font-medium text-paper-raised' : 'text-ink hover:bg-paper-inset/80',
              )}
            >
              {active && (
                <motion.span
                  layoutId="reasoning-effort-active"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
      </div>
      </SettingGroup>

      <SettingGroup title="工作区">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2.5">
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
      </SettingGroup>

      <HarnessLessonsSection />
      </div>
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
          uiStore.closeSettings();
        }}
        className="mt-6 text-sm text-accent hover:opacity-80"
      >
        返回工作区
      </button>
    </div>
  );
}
