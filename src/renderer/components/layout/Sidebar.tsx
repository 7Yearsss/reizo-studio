import { useEffect, useState } from 'react';
import {
  ChevronDown,
  CirclePlus,
  Flame,
  FolderKanban,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Timer,
  Trash2,
  UserRound,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { APP_VERSION } from '../../../shared/constants';
import { useChatStore } from '../../state/useChatStore';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useTabStore } from '../../state/useTabStore';
import { useProjectStore } from '../../state/useProjectStore';
import { useSkillStore } from '../../state/useSkillStore';
import { useUiStore } from '../../state/useUiStore';
import * as chatStore from '../../state/chatStore';
import * as tabStore from '../../state/tabStore';
import * as projectStore from '../../state/projectStore';
import * as uiStore from '../../state/uiStore';
import * as skillStore from '../../state/skillStore';
import * as api from '../../api';
import type { DirEntry } from '../../../shared/workspace';
import type { SidebarMode } from '../../state/uiStore';
import ProjectDialog from './ProjectDialog';

const COLLAPSE_KEY = 'reizo:sidebar-collapsed';

const RAIL: { id: SidebarMode; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'projects', label: '项目', icon: FolderKanban },
  { id: 'skills', label: '技能', icon: Sparkles },
  { id: 'settings', label: '设置', icon: Settings },
];

export default function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const loaded = useChatStore((s) => s.sessionsLoaded);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const projects = useProjectStore((s) => s.projects);
  const projectsLoaded = useProjectStore((s) => s.loaded);
  const skills = useSkillStore().skills;
  const mode = useUiStore((s) => s.mode);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileHits, setFileHits] = useState<DirEntry[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [tasksOpen, setTasksOpen] = useState(true);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);

  useEffect(() => {
    if (!loaded) void chatStore.loadSessions();
  }, [loaded]);

  useEffect(() => {
    if (!projectsLoaded) void projectStore.loadProjects();
  }, [projectsLoaded]);

  useEffect(() => {
    if (!query.trim() || !workspacePath) {
      setFileHits([]);
      return;
    }
    const q = query.trim().toLowerCase();
    void api
      .flattenWorkspace()
      .then((entries) => setFileHits(entries.filter((e) => e.relativePath.toLowerCase().includes(q)).slice(0, 12)))
      .catch(() => setFileHits([]));
  }, [query, workspacePath]);

  const visibleSessions = (
    workspacePath ? sessions.filter((s) => !s.workspacePath || s.workspacePath === workspacePath) : sessions
  ).filter((s) => !query.trim() || s.title.toLowerCase().includes(query.trim().toLowerCase()));

  const projectSessions = selectedProjectId
    ? sessions.filter((s) => s.projectId === selectedProjectId)
    : [];

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  function onRail(id: SidebarMode) {
    if (collapsed) {
      localStorage.setItem(COLLAPSE_KEY, '0');
      setCollapsed(false);
    }
    uiStore.setMode(id);
    if (id === 'settings') tabStore.openSettingsTab();
  }

  const railActive = (id: SidebarMode) => {
    if (id === 'settings') return mode === 'settings' || activeTab?.kind === 'settings';
    if (id === 'skills') return mode === 'skills' || activeTab?.kind === 'plugins';
    return mode === id;
  };

  const row = (active: boolean) =>
    cn(
      'flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-sm text-ink hover:bg-paper-inset/70',
      active && 'bg-paper-inset/80 font-medium',
    );

  return (
    <aside className="flex h-full shrink-0 bg-sidebar">
      <nav className="flex w-14 shrink-0 flex-col items-center border-r border-line/70 py-3" aria-label="Studio 模式">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="mb-2 rounded-md p-1.5 text-ink-muted hover:bg-paper-inset/70 hover:text-ink"
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <div className="flex w-full flex-col items-center gap-1 px-1.5">
          {RAIL.map((item) => {
            const Icon = item.icon;
            const active = railActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onRail(item.id)}
                data-active={active ? 'true' : 'false'}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={cn(
                  'flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-[10px] transition-colors duration-200',
                  active ? 'bg-paper-inset/80 font-medium text-ink' : 'text-ink-muted hover:bg-paper-inset/50 hover:text-ink',
                )}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className={cn("flex h-full min-w-0 flex-col overflow-hidden transition-[width,opacity] duration-200 ease-out", collapsed ? "w-0 opacity-0" : "w-[196px] opacity-100")} aria-hidden={collapsed}>
        <div className="flex h-full w-[196px] min-w-0 flex-col">
          <div className="flex items-center gap-1 px-3 pt-3 pb-2">
            <span className="flex-1 truncate text-[15px] font-semibold tracking-tight">Reizo</span>
          </div>

          {mode === 'chat' && (
            <div className="anim-fade flex min-h-0 flex-1 flex-col">
              <div className="flex flex-col gap-0.5 px-2">
                <button type="button" onClick={() => tabStore.newLauncherTab()} className={row(activeTab?.kind === 'launcher')}>
                  <CirclePlus size={15} strokeWidth={1.8} className="shrink-0" />
                  新建
                </button>
                <button type="button" onClick={() => tabStore.openAutomationTab()} className={row(activeTab?.kind === 'automation')}>
                  <Timer size={15} strokeWidth={1.8} className="shrink-0" />
                  自动化
                </button>
                {searchOpen ? (
                  <div className="flex h-8 items-center gap-2 rounded-full bg-paper px-3">
                    <Search size={15} className="shrink-0 text-ink-muted" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onBlur={() => {
                        if (!query.trim()) setSearchOpen(false);
                      }}
                      placeholder="搜索会话和文件"
                      className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
                    />
                  </div>
                ) : (
                  <button type="button" onClick={() => setSearchOpen(true)} className={row(false)}>
                    <Search size={15} strokeWidth={1.8} className="shrink-0" />
                    搜索
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setTasksOpen((o) => !o)}
                className="mt-4 flex items-center gap-1 px-4 text-xs text-ink-muted"
              >
                全部任务
                <ChevronDown size={12} className={cn('transition', !tasksOpen && '-rotate-90')} />
              </button>

              <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-2">
                {tasksOpen &&
                  visibleSessions.map((session) => {
                    const active = activeTab?.kind === 'chat' && activeTab.sessionId === session.id;
                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => tabStore.openChatTab(session.id, session.title)}
                        className={cn(
                          'group flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
                          active && 'bg-paper-inset/80 text-ink',
                        )}
                      >
                        <SquarePen size={14} className="shrink-0 opacity-70" />
                        {renamingId === session.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => {
                              if (renameValue.trim()) void chatStore.renameSession(session.id, renameValue.trim());
                              setRenamingId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
                          />
                        ) : (
                          <span
                            className="flex-1 truncate"
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setRenamingId(session.id);
                              setRenameValue(session.title);
                            }}
                          >
                            {session.title}
                          </span>
                        )}
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void chatStore.deleteSession(session.id);
                          }}
                          className="hidden shrink-0 rounded p-1 text-ink-muted hover:bg-paper hover:text-danger group-hover:block"
                          aria-label="删除会话"
                        >
                          <Trash2 size={13} />
                        </span>
                      </button>
                    );
                  })}
                {searchOpen && fileHits.length > 0 && (
                  <div className="pt-2">
                    <p className="px-3 pb-1 text-[11px] text-ink-muted">文件</p>
                    {fileHits.map((hit) => (
                      <div key={hit.relativePath} className="truncate px-3 py-1 text-xs text-ink-muted">
                        {hit.relativePath}
                      </div>
                    ))}
                  </div>
                )}
              </nav>
            </div>
          )}

          {mode === 'projects' && (
            <div className="anim-fade flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-1 px-2">
                <button
                  type="button"
                  onClick={() => setProjectsOpen((o) => !o)}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded-xl px-3 py-2 text-left text-[13px] text-ink-muted"
                >
                  项目
                </button>
                <button
                  type="button"
                  onClick={() => setProjectDialogOpen(true)}
                  title="新建项目"
                  aria-label="新建项目"
                  className="mr-1 inline-flex size-7 items-center justify-center rounded-lg text-ink-muted hover:bg-paper-inset hover:text-ink"
                >
                  <Plus size={14} />
                </button>
              </div>
              <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
                {projectsOpen && projects.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setProjectDialogOpen(true)}
                    className="w-full rounded-xl px-3 py-2 text-left text-xs leading-5 text-ink-muted hover:bg-paper-inset/70"
                  >
                    创建一个项目
                  </button>
                )}
                {projectsOpen &&
                  projects.map((project) => {
                    const active = selectedProjectId === project.id;
                    const count = sessions.filter((s) => s.projectId === project.id).length;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => uiStore.selectProject(active ? null : project.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
                          active && 'bg-paper-inset/80 text-ink',
                        )}
                        title={project.description || project.name}
                      >
                        <FolderKanban size={14} className="shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        {count ? <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{count}</span> : null}
                      </button>
                    );
                  })}
                {selectedProjectId && (
                  <div className="pt-3">
                    <div className="mb-1 flex items-center justify-between px-1">
                      <p className="px-2 text-[11px] text-ink-muted">项目对话</p>
                      <button
                        type="button"
                        className="text-[11px] text-accent"
                        onClick={async () => {
                          const session = await chatStore.createSession('新对话', selectedProjectId);
                          tabStore.openChatTab(session.id, session.title);
                        }}
                      >
                        新建
                      </button>
                    </div>
                    {projectSessions.length === 0 && (
                      <p className="px-3 py-1.5 text-xs text-ink-muted">这个项目还没有对话</p>
                    )}
                    {projectSessions.map((session) => {
                      const active = activeTab?.kind === 'chat' && activeTab.sessionId === session.id;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => tabStore.openChatTab(session.id, session.title)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
                            active && 'bg-paper-inset/80 text-ink',
                          )}
                        >
                          <SquarePen size={14} className="shrink-0 opacity-70" />
                          <span className="flex-1 truncate">{session.title}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="mt-2 px-3 text-[11px] text-danger"
                      onClick={async () => {
                        await projectStore.deleteProject(selectedProjectId);
                        uiStore.selectProject(null);
                        await chatStore.loadSessions();
                      }}
                    >
                      删除项目
                    </button>
                  </div>
                )}
              </nav>
            </div>
          )}

          {mode === 'skills' && (
            <div className="anim-fade flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between px-4 pt-1 pb-2">
                <p className="text-[13px] text-ink-muted">技能</p>
                <button type="button" onClick={() => tabStore.openPluginsTab()} className="text-[11px] text-accent">
                  管理
                </button>
              </div>
              <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={async () => {
                      const session = await chatStore.createSession(`/${skill.id}`);
                      tabStore.openChatTab(session.id, session.title);
                      void chatStore.sendMessage(session.id, `请按技能 ${skill.name} 开始工作。`, [], { skillId: skill.id });
                    }}
                    className="flex w-full flex-col rounded-lg px-3 py-1.5 text-left hover:bg-paper-inset/70"
                  >
                    <span className="truncate text-sm text-ink">{skill.name}</span>
                    <span className="truncate text-[11px] text-ink-muted">{skill.description || `/${skill.id}`}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="mt-2 w-full rounded-lg px-3 py-2 text-left text-xs text-ink-muted hover:bg-paper-inset/70"
                  onClick={async () => {
                    const installed = await window.reizo.installSkill();
                    if (installed) await skillStore.loadSkills();
                  }}
                >
                  安装 SKILL.md
                </button>
              </nav>
            </div>
          )}

          {mode === 'settings' && (
            <div className="anim-fade flex-1 px-4 py-2 text-sm text-ink-muted">
              <p>在右侧打开设置页，配置模型和外观。</p>
              <button type="button" onClick={() => tabStore.openSettingsTab()} className="mt-3 text-accent">
                打开设置
              </button>
            </div>
          )}

          <div className="p-2 pb-3">
            <div className="flex items-center gap-2 rounded-full bg-paper px-2 py-1.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-paper-inset text-ink-muted">
                <UserRound size={14} />
              </span>
              <button type="button" onClick={() => tabStore.openSettingsTab()} className="min-w-0 flex-1 text-left">
                <div className="truncate text-xs font-medium text-ink">未登录</div>
                <div className="truncate text-[10px] text-ink-muted">本地 · {APP_VERSION}</div>
              </button>
              <button type="button" className="rounded-full p-1 text-ink-muted hover:text-ink" title="本机">
                <Flame size={13} />
              </button>
              <button
                type="button"
                onClick={() => {
                  uiStore.setMode('settings');
                  tabStore.openSettingsTab();
                }}
                className="rounded-full p-1 text-ink-muted hover:text-ink"
                title="设置"
              >
                <Settings size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <ProjectDialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} />
    </aside>
  );
}
