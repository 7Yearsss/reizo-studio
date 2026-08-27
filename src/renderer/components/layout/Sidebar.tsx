import { useEffect, useState } from 'react';
import {
  ChevronDown,
  CirclePlus,
  Flame,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
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
import * as chatStore from '../../state/chatStore';
import * as tabStore from '../../state/tabStore';
import * as api from '../../api';
import type { DirEntry } from '../../../shared/workspace';

const COLLAPSE_KEY = 'reizo:sidebar-collapsed';

export default function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const loaded = useChatStore((s) => s.sessionsLoaded);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileHits, setFileHits] = useState<DirEntry[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [tasksOpen, setTasksOpen] = useState(true);

  useEffect(() => {
    if (!loaded) void chatStore.loadSessions();
  }, [loaded]);

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

  const visible = (workspacePath
    ? sessions.filter((s) => !s.workspacePath || s.workspacePath === workspacePath)
    : sessions
  ).filter((s) => !query.trim() || s.title.toLowerCase().includes(query.trim().toLowerCase()));

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  const row = (active: boolean) =>
    cn(
      'flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-sm text-ink hover:bg-paper-inset/70',
      active && 'bg-paper-inset/80 font-medium',
      collapsed && 'justify-center px-0',
    );

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col bg-sidebar transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-[232px]',
      )}
    >
      <div className={cn('flex items-center gap-1 px-3 pt-3 pb-2', collapsed && 'justify-center')}>
        <button
          onClick={toggleCollapsed}
          className="rounded-md p-1.5 text-ink-muted hover:bg-paper-inset/70 hover:text-ink"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        {!collapsed && <span className="flex-1 truncate text-[15px] font-semibold tracking-tight">Reizo</span>}
      </div>

      <div className="flex flex-col gap-0.5 px-2">
        <button type="button" onClick={() => tabStore.newLauncherTab()} className={row(activeTab?.kind === 'launcher')}>
          <CirclePlus size={15} strokeWidth={1.8} className="shrink-0" />
          {!collapsed && '新建'}
        </button>
        <button type="button" onClick={() => tabStore.openAutomationTab()} className={row(activeTab?.kind === 'automation')}>
          <Timer size={15} strokeWidth={1.8} className="shrink-0" />
          {!collapsed && '自动化'}
        </button>
        <button type="button" onClick={() => tabStore.openPluginsTab()} className={row(activeTab?.kind === 'plugins')}>
          <Plug size={15} strokeWidth={1.8} className="shrink-0" />
          {!collapsed && '插件'}
        </button>
        {!collapsed ? (
          searchOpen ? (
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
          )
        ) : (
          <button type="button" onClick={toggleCollapsed} className={row(false)} aria-label="搜索">
            <Search size={15} />
          </button>
        )}
      </div>

      {!collapsed && (
        <button
          type="button"
          onClick={() => setTasksOpen((o) => !o)}
          className="mt-4 flex items-center gap-1 px-4 text-xs text-ink-muted"
        >
          全部任务
          <ChevronDown size={12} className={cn('transition', !tasksOpen && '-rotate-90')} />
        </button>
      )}

      <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-2">
        {tasksOpen &&
          visible.map((session) => {
            const active = activeTab?.kind === 'chat' && activeTab.sessionId === session.id;
            return (
              <button
                key={session.id}
                onClick={() => tabStore.openChatTab(session.id, session.title)}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
                  active && 'bg-paper-inset/80 text-ink',
                  collapsed && 'justify-center',
                )}
              >
                <SquarePen size={14} className="shrink-0 opacity-70" />
                {!collapsed && (
                  <>
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
                      aria-label="Delete session"
                    >
                      <Trash2 size={13} />
                    </span>
                  </>
                )}
              </button>
            );
          })}
        {searchOpen && !collapsed && fileHits.length > 0 && (
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

      <div className="p-2 pb-3">
        <div
          className={cn(
            'flex items-center gap-2 rounded-full bg-paper px-2 py-1.5',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-paper-inset text-ink-muted">
            <UserRound size={14} />
          </span>
          {!collapsed && (
            <>
              <button type="button" onClick={() => tabStore.openSettingsTab()} className="min-w-0 flex-1 text-left">
                <div className="truncate text-xs font-medium text-ink">未登录</div>
                <div className="truncate text-[10px] text-ink-muted">本地 · {APP_VERSION}</div>
              </button>
              <button type="button" className="rounded-full p-1 text-ink-muted hover:text-ink" title="本机">
                <Flame size={13} />
              </button>
              <button
                type="button"
                onClick={() => tabStore.openSettingsTab()}
                className="rounded-full p-1 text-ink-muted hover:text-ink"
                title="设置"
              >
                <Settings size={13} />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
