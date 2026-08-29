import { useEffect, useState } from 'react';
import {
  ChevronRight,
  CirclePlus,
  FolderKanban,
  LayoutGrid,
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
import { useUiStore } from '../../state/useUiStore';
import * as chatStore from '../../state/chatStore';
import * as tabStore from '../../state/tabStore';
import * as projectStore from '../../state/projectStore';
import * as uiStore from '../../state/uiStore';
import * as api from '../../api';
import type { DirEntry } from '../../../shared/workspace';
import ProjectDialog from './ProjectDialog';

const COLLAPSE_KEY = 'reizo:sidebar-collapsed';
const PROJECTS_FOLD_KEY = 'reizo:sidebar-projects';
const CHATS_FOLD_KEY = 'reizo:sidebar-chats';

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export default function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const loaded = useChatStore((s) => s.sessionsLoaded);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const projects = useProjectStore((s) => s.projects);
  const projectsLoaded = useProjectStore((s) => s.loaded);
  const mode = useUiStore((s) => s.mode);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileHits, setFileHits] = useState<DirEntry[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(() => localStorage.getItem(PROJECTS_FOLD_KEY) !== '0');
  const [chatsOpen, setChatsOpen] = useState(() => localStorage.getItem(CHATS_FOLD_KEY) !== '0');
  const searchModHint = isMacPlatform() ? '⌘K' : 'Ctrl+K';

  // The title bar lives outside the content row, so publish the current rail
  // width for its leading spacer. This keeps tabs aligned with the work area
  // when the sidebar is collapsed or expanded.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${collapsed ? 40 : 248}px`);
  }, [collapsed]);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (collapsed) {
          localStorage.setItem(COLLAPSE_KEY, '0');
          setCollapsed(false);
        }
        setSearchOpen(true);
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !typing) {
        event.preventDefault();
        if (collapsed) {
          localStorage.setItem(COLLAPSE_KEY, '0');
          setCollapsed(false);
        }
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed]);

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

  function toggleProjectsOpen() {
    setProjectsOpen((o) => {
      const next = !o;
      localStorage.setItem(PROJECTS_FOLD_KEY, next ? '1' : '0');
      return next;
    });
  }

  function toggleChatsOpen() {
    setChatsOpen((o) => {
      const next = !o;
      localStorage.setItem(CHATS_FOLD_KEY, next ? '1' : '0');
      return next;
    });
  }

  const navRow = (active: boolean) =>
    cn(
      'flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[14px] text-ink-muted outline-none transition-colors hover:bg-paper-inset/70 hover:text-ink',
      active && 'bg-paper-inset/80 font-medium text-ink',
    );

  const foldRow =
    'flex min-w-0 items-center gap-1 rounded-xl px-3 py-2 text-left text-[13px] text-ink-muted outline-none transition-colors hover:text-ink';

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-line/70 bg-sidebar transition-[width] duration-[var(--duration-base)] ease-[var(--ease-drawer)] motion-reduce:transition-none"
      style={{ width: collapsed ? 40 : 248 }}
    >
      {collapsed && (
        <div className="anim-fade flex flex-col items-center py-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            title="展开侧栏"
            aria-label="展开侧栏"
            aria-expanded={false}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-paper-inset/70 hover:text-ink"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      )}
      <div
        className="anim-fade flex h-full w-[248px] flex-col px-3 py-3"
        style={collapsed ? { display: 'none' } : undefined}
      >
      <div className="mb-3 flex items-center gap-1 px-1">
        <span className="flex-1 truncate px-2 text-[15px] font-semibold tracking-tight text-ink">Reizo</span>
        <button
          type="button"
          onClick={toggleCollapsed}
          title="收起侧栏"
          aria-label="收起侧栏"
          aria-expanded
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-paper-inset/70 hover:text-ink"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {searchOpen ? (
        <div className="mb-2 flex h-10 items-center gap-2 rounded-[14px] bg-paper px-3">
          <Search size={16} className="shrink-0 text-ink-muted" strokeWidth={1.8} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => {
              if (!query.trim()) setSearchOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                setSearchOpen(false);
              }
            }}
            placeholder="搜索会话和文件"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setSearchOpen(true)} className={cn(navRow(false), 'mb-2')}>
          <Search size={18} className="shrink-0" strokeWidth={1.8} />
          快速搜索
          <kbd className="ml-auto inline-flex h-[18px] items-center justify-center rounded-[5px] border border-line/80 bg-paper px-1.5 text-[10.5px] font-medium text-ink-muted">
            {searchModHint}
          </kbd>
        </button>
      )}

      <nav className="flex flex-col gap-0.5" aria-label="Studio 导航">
        <button
          type="button"
          onClick={() => {
            uiStore.setMode('chat');
            tabStore.newLauncherTab();
          }}
          className={navRow(mode === 'chat' && activeTab?.kind === 'launcher')}
        >
          <CirclePlus size={18} className="shrink-0" strokeWidth={1.8} />
          开始创作
        </button>
        <button
          type="button"
          onClick={() => uiStore.setMode('skills')}
          className={navRow(mode === 'skills')}
        >
          <Sparkles size={18} className="shrink-0" strokeWidth={1.8} />
          技能
        </button>
        <button
          type="button"
          onClick={() => {
            uiStore.setArtifactsOpen(false);
            uiStore.setMode('artifacts');
          }}
          className={navRow(mode === 'artifacts')}
        >
          <LayoutGrid size={18} className="shrink-0" strokeWidth={1.8} />
          我的作品
        </button>
        <button
          type="button"
          onClick={() => uiStore.setMode('automation')}
          className={navRow(mode === 'automation')}
        >
          <Timer size={18} className="shrink-0" strokeWidth={1.8} />
          自动化
        </button>
        <button
          type="button"
          onClick={() => {
            uiStore.setMode('settings');
          }}
          className={navRow(mode === 'settings')}
        >
          <Settings size={18} className="shrink-0" strokeWidth={1.8} />
          设置
        </button>
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex min-h-0 shrink-0 flex-col">
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggleProjectsOpen} className={cn(foldRow, 'flex-1')} aria-expanded={projectsOpen}>
              <ChevronRight
                size={14}
                className={cn(
                  'shrink-0 transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
                  projectsOpen && 'rotate-90',
                )}
              />
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
          {projectsOpen && (
            <div className="anim-fade max-h-40 shrink-0 overflow-y-auto px-1 pb-2">
              {projects.length === 0 && (
                <button
                  type="button"
                  onClick={() => setProjectDialogOpen(true)}
                  className="w-full rounded-xl px-3 py-2 text-left text-xs leading-5 text-ink-muted hover:bg-paper-inset/70"
                >
                  创建一个项目
                </button>
              )}
              {projects.map((project) => {
                const active = selectedProjectId === project.id;
                const count = sessions.filter((s) => s.projectId === project.id).length;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      uiStore.selectProject(active ? null : project.id);
                      uiStore.setMode('chat');
                    }}
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
                <div className="pt-2">
                  <div className="mb-1 flex items-center justify-between px-1">
                    <p className="px-2 text-[11px] text-ink-muted">项目对话</p>
                    <button
                      type="button"
                      className="text-[11px] text-accent"
                      onClick={async () => {
                        const session = await chatStore.createSession('新对话', selectedProjectId);
                        uiStore.setMode('chat');
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
                        onClick={() => {
                          uiStore.setMode('chat');
                          tabStore.openChatTab(session.id, session.title);
                        }}
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
                    className="mt-2 px-3 text-[11px] text-ink-muted transition-colors hover:text-danger"
                    onClick={async () => {
                      if (!window.confirm('删除这个项目？其中的对话会保留。')) return;
                      await projectStore.deleteProject(selectedProjectId);
                      uiStore.selectProject(null);
                      await chatStore.loadSessions();
                    }}
                  >
                    删除项目
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <button type="button" onClick={toggleChatsOpen} className={cn(foldRow, 'w-full')} aria-expanded={chatsOpen}>
            <ChevronRight
              size={14}
              className={cn(
                'shrink-0 transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
                chatsOpen && 'rotate-90',
              )}
            />
            对话
          </button>
          {chatsOpen && (
            <nav className="anim-fade min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 pb-2">
              {visibleSessions.length === 0 && !query.trim() && (
                <p className="px-3 py-1.5 text-xs text-ink-muted">暂无会话</p>
              )}
              {visibleSessions.map((session) => {
                const active = activeTab?.kind === 'chat' && activeTab.sessionId === session.id;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      uiStore.setMode('chat');
                      tabStore.openChatTab(session.id, session.title);
                    }}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
                      active && 'bg-paper-inset/80 text-ink',
                    )}
                  >
                    <SquarePen size={14} className="mt-0.5 shrink-0 self-start opacity-70" />
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
                        className="flex min-w-0 flex-1 flex-col"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(session.id);
                          setRenameValue(session.title);
                        }}
                      >
                        <span className="truncate">{session.title}</span>
                        {session.listPreview && (
                          <span className="truncate text-[11px] leading-tight text-ink-muted/80">
                            {session.listPreview}
                          </span>
                        )}
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
                      className="mt-0.5 shrink-0 self-start rounded p-1 text-ink-muted opacity-0 transition-opacity duration-[140ms] hover:bg-paper hover:text-danger group-hover:opacity-100"
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
          )}
        </div>
      </div>

      <div className="mt-auto p-1 pb-1">
        <div className="flex items-center gap-2 rounded-full bg-paper px-2 py-1.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-paper-inset text-ink-muted">
            <UserRound size={14} />
          </span>
          <button
            type="button"
            onClick={() => {
              uiStore.setMode('settings');
            }}
            className="min-w-0 flex-1 text-left"
          >
            <div className="truncate text-xs font-medium text-ink">未登录</div>
            <div className="truncate text-[10px] text-ink-muted">本地 · {APP_VERSION}</div>
          </button>
        </div>
      </div>
      </div>

      <ProjectDialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} />
    </aside>
  );
}
