import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  CirclePlus,
  Activity,
  Download,
  LayoutGrid,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Sparkles,
  SquarePen,
  Timer,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import AccountControl from './AccountControl';
import { useChatStore } from '../../state/useChatStore';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useTabStore } from '../../state/useTabStore';
import { useUiStore } from '../../state/useUiStore';
import * as chatStore from '../../state/chatStore';
import * as tabStore from '../../state/tabStore';
import * as settingsStore from '../../state/settingsStore';
import * as uiStore from '../../state/uiStore';
import * as api from '../../api';
import type { DirEntry } from '../../../shared/workspace';
import type { SessionSummary } from '../../../shared/chat';
import { organizeSessions } from '../../../shared/sessionOrganize';
import { matchAny } from '../../../shared/matchText';
import type { ChatInteraction } from '../../state/chatStore';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../motion/context-menu';
import { openGlobalCommandPalette } from './GlobalCommandPalette';
import { toast } from '../../lib/toast';
import TrashPanel from './TrashPanel';
import { useSessionHoverPreview } from './SessionHoverPreview';

/** Delete moves the conversation to the trash; the toast offers an immediate undo instead of a confirm dialog. */
async function deleteWithUndo(id: string, title: string): Promise<void> {
  try {
    await chatStore.deleteSession(id);
  } catch {
    toast.error('无法删除', '会话正在运行，请先停止');
    return;
  }
  toast.show({
    title: `已删除「${title}」`,
    status: 'info',
    duration: 6000,
    action: { label: '撤销', onClick: () => void chatStore.restoreSession(id) },
  });
}
import Tooltip from '../ui/Tooltip';

/** Download a shareable copy of one conversation, then say what was replaced so nothing is a surprise. */
async function exportSessionFile(session: SessionSummary, detail: 'structure' | 'full'): Promise<void> {
  try {
    const exported = await api.exportSession(session.id, detail === 'full' ? 'md' : 'json', detail);
    const body = detail === 'full' ? exported.content ?? '' : JSON.stringify({ title: exported.title, messages: exported.messages }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: detail === 'full' ? 'text/markdown' : 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${session.title.replace(/[/\\:*?"<>|]+/g, '_').slice(0, 40) || 'conversation'}.${detail === 'full' ? 'md' : 'json'}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    const { secrets, paths, emails } = exported.stats;
    toast.success('已导出', `已替换 ${secrets} 处密钥、${paths} 处本机路径、${emails} 个邮箱`);
  } catch (error) {
    toast.error('导出失败', error instanceof Error ? error.message : undefined);
  }
}

/** Archive tucks a conversation away without deleting it. A running one is not archived silently: the toast offers to stop it first. */
async function archiveSession(session: SessionSummary): Promise<void> {
  try {
    await chatStore.setSessionOrganized(session.id, { archived: true });
  } catch (error) {
    if (error instanceof api.ApiRequestError && error.status === 409) {
      toast.show({
        title: `「${session.title}」还在运行`,
        status: 'info',
        duration: 8000,
        action: {
          label: '停止并归档',
          onClick: () => void chatStore.stopMessage(session.id).then(() => chatStore.setSessionOrganized(session.id, { archived: true, force: true })),
        },
      });
      return;
    }
    toast.error('无法归档', error instanceof Error ? error.message : undefined);
    return;
  }
  toast.show({
    title: `已归档「${session.title}」`,
    status: 'info',
    duration: 5000,
    action: { label: '撤销', onClick: () => void chatStore.setSessionOrganized(session.id, { archived: false }) },
  });
}

const COLLAPSE_KEY = 'reizo:sidebar-collapsed';
const FOLDER_FOLD_KEY = 'reizo:sidebar-folders';
const CHATS_FOLD_KEY = 'reizo:sidebar-chats';

function folderName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function folderKey(path: string): string {
  return path.replace(/[/\\]+$/, '').toLowerCase();
}

function samePath(a: string, b: string): boolean {
  return folderKey(a) === folderKey(b);
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

/**
 * Live stream state wins over the session-list snapshot: `undefined` means the
 * session never streamed this run (fall back to the list field), `null` means
 * it streamed and the interaction was answered.
 */
function pendingKindFor(
  session: SessionSummary,
  interactionBySession: Record<string, ChatInteraction | null>,
): 'ask' | 'permission' | null {
  const live = interactionBySession[session.id];
  if (live === undefined) return session.pendingInteraction ?? null;
  return live ? live.kind : null;
}

function PendingInteractionBadge({ kind }: { kind: 'ask' | 'permission' }) {
  return (
    <span className="mt-0.5 shrink-0 self-start rounded-full bg-[var(--peach)] px-2 py-0.5 text-[11px] font-medium leading-none text-[var(--peach-ink)]">
      {kind === 'ask' ? '待回答' : '待批准'}
    </span>
  );
}

/** Fixed 14px status slot: spinner = running, peach = waiting on you, ink = unread, empty otherwise. */
function SessionStatus({ pending, unread, running }: { pending: boolean; unread: boolean; running: boolean }) {
  return (
    <span className="mt-1 flex size-3.5 shrink-0 items-center justify-center self-start" aria-hidden={!pending && !unread && !running}>
      {running && !pending ? (
        <span className="size-3 animate-spin rounded-full border-2 border-line border-t-ink" aria-label="运行中" />
      ) : pending ? (
        <span className="size-2 rounded-full bg-[var(--peach-bar)]" />
      ) : unread ? (
        <span className="size-1.5 rounded-full bg-ink" aria-label="有新回复" />
      ) : null}
    </span>
  );
}

function SessionContextMenu({
  session,
  onRename,
  children,
}: {
  session: SessionSummary;
  onRename?: () => void;
  children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-40 rounded-xl border border-line bg-paper-raised p-1 shadow-xl">
        <ContextMenuItem
          onSelect={() => {
            uiStore.setMode('chat');
            tabStore.openChatTab(session.id, session.title);
          }}
        >
          <span className="flex items-center gap-2">
            <SquarePen size={13} /> 打开
          </span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => window.dispatchEvent(new CustomEvent('reizo:open-trace', { detail: { id: session.id, title: session.title } }))}>
          <span className="flex items-center gap-2">
            <Activity size={13} /> 查看运行记录
          </span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void exportSessionFile(session, 'full')}>
          <span className="flex items-center gap-2">
            <Download size={13} /> 导出对话（脱敏）
          </span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void exportSessionFile(session, 'structure')}>
          <span className="flex items-center gap-2">
            <Download size={13} /> 导出排障版（不含正文）
          </span>
        </ContextMenuItem>
        {onRename && (
          <ContextMenuItem onSelect={onRename}>
            <span className="flex items-center gap-2">
              <Pencil size={13} /> 重命名
            </span>
          </ContextMenuItem>
        )}
        {session.archivedAt ? (
          <ContextMenuItem onSelect={() => void chatStore.setSessionOrganized(session.id, { archived: false })}>
            <span className="flex items-center gap-2">
              <ArchiveRestore size={13} /> 取消归档
            </span>
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem onSelect={() => void chatStore.setSessionOrganized(session.id, { pinned: !session.pinnedAt })}>
              <span className="flex items-center gap-2">
                {session.pinnedAt ? <PinOff size={13} /> : <Pin size={13} />} {session.pinnedAt ? '取消置顶' : '置顶'}
              </span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void archiveSession(session)}>
              <span className="flex items-center gap-2">
                <Archive size={13} /> 归档
              </span>
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator className="my-1 h-px bg-line" />
        <ContextMenuItem
          tone="destructive"
          onSelect={() => {
            void deleteWithUndo(session.id, session.title);
          }}
        >
          <span className="flex items-center gap-2">
            <Trash2 size={13} /> 删除会话
          </span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const loaded = useChatStore((s) => s.sessionsLoaded);
  const interactionBySession = useChatStore((s) => s.interactionBySession);
  const unreadBySession = useChatStore((s) => s.unreadBySession);
  const sendingBySession = useChatStore((s) => s.sendingBySession);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const mode = useUiStore((s) => s.mode);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);

  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const asideRef = useRef<HTMLElement>(null);
  const dragWidth = useRef<number | null>(null);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileHits, setFileHits] = useState<DirEntry[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Folder rows are expanded unless the user collapsed them; the stored value is the collapsed set.
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(FOLDER_FOLD_KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const [trashOpen, setTrashOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const hoverPreview = useSessionHoverPreview();
  const [chatsOpen, setChatsOpen] = useState(() => localStorage.getItem(CHATS_FOLD_KEY) !== '0');

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${collapsed ? 0 : sidebarWidth}px`);
  }, [collapsed, sidebarWidth]);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openGlobalCommandPalette();
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !typing) {
        event.preventDefault();
        openGlobalCommandPalette();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (session: SessionSummary) => !q || matchAny(q, [session.title, session.listPreview ?? '']) > 0;

  // Pinned rows float above the folders; archived ones live in their own fold at the bottom.
  const organized = organizeSessions(sessions);
  const pinnedVisible = organized.pinned.filter(matches);
  const archivedVisible = organized.archived.filter(matches);

  // A project is a workspace folder: one row per distinct `workspacePath` seen on any session, plus the
  // currently selected folder so it shows up the moment it is picked, before its first message.
  const folderGroups = (() => {
    const map = new Map<string, { path: string; sessions: SessionSummary[] }>();
    const keyOf = folderKey;
    if (workspacePath) map.set(keyOf(workspacePath), { path: workspacePath, sessions: [] });
    const loose: SessionSummary[] = [];
    for (const session of organized.rest) {
      if (!session.workspacePath) { loose.push(session); continue; }
      const key = keyOf(session.workspacePath);
      const group = map.get(key) ?? { path: session.workspacePath, sessions: [] };
      group.sessions.push(session);
      map.set(key, group);
    }
    const groups = [...map.values()]
      .map((g) => ({ ...g, visible: g.sessions.filter(matches) }))
      .filter((g) => !q || g.visible.length > 0)
      .sort((x, y) => {
        const cur = Number(!!workspacePath && samePath(y.path, workspacePath)) - Number(!!workspacePath && samePath(x.path, workspacePath));
        if (cur) return cur;
        const latest = (g: { sessions: SessionSummary[] }) => Math.max(0, ...g.sessions.map((s) => Date.parse(s.updatedAt) || 0));
        return latest(y) - latest(x);
      });
    return { groups, loose: loose.filter(matches) };
  })();

  function isFolderOpen(key: string): boolean {
    return !!q || !collapsedFolders.includes(key);
  }

  function toggleFolder(key: string) {
    setCollapsedFolders((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem(FOLDER_FOLD_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  async function newChatInFolder(path: string) {
    if (!workspacePath || !samePath(path, workspacePath)) await settingsStore.patchSettings({ workspacePath: path });
    const session = await chatStore.createSession('新对话');
    uiStore.setMode('chat');
    tabStore.openChatTab(session.id, session.title);
  }

  function toggleCollapsed() {
    uiStore.toggleSidebar();
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
      'flex min-h-10 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[14px] leading-5 text-ink/75 outline-none transition-colors duration-150 hover:bg-[var(--sidebar-hover)] hover:text-ink focus-visible:inset-ring-2 focus-visible:inset-ring-ink/30 motion-reduce:transition-none',
      active && 'bg-[var(--sidebar-selected)] font-medium text-ink shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:bg-[var(--sidebar-selected)]',
    );

  const foldRow =
    'flex min-w-0 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-medium leading-5 text-ink-muted outline-none transition-colors hover:text-ink focus-visible:inset-ring-2 focus-visible:inset-ring-ink/30';

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    setIsDragging(true);
    // Lets non-React listeners (the titlebar's sidebar-width section) drop
    // their width transition while the pointer drags.
    document.documentElement.classList.add('sidebar-resizing');
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    const calculatedWidth = startWidth.current + delta;

    if (calculatedWidth < uiStore.SIDEBAR_COLLAPSE_THRESHOLD) {
      uiStore.setSidebarCollapsed(true);
      dragging.current = false;
      setIsDragging(false);
      document.documentElement.classList.remove('sidebar-resizing');
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    // Resize by mutating the DOM node directly — committing through the store
    // on every pointermove re-renders the whole sidebar each frame and stalls
    // on long message lists. The store (and localStorage) sees one write on release.
    const clamped = Math.min(
      uiStore.SIDEBAR_MAX_WIDTH,
      Math.max(uiStore.SIDEBAR_MIN_WIDTH, Math.round(calculatedWidth)),
    );
    dragWidth.current = clamped;
    if (asideRef.current) asideRef.current.style.width = `${clamped}px`;
    document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    document.documentElement.classList.remove('sidebar-resizing');
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (dragWidth.current !== null) {
      uiStore.setSidebarWidth(dragWidth.current);
      dragWidth.current = null;
    }
  };

  const renderSession = (session: SessionSummary) => {
    const active = activeTab?.kind === 'chat' && activeTab.sessionId === session.id;
    const pendingKind = pendingKindFor(session, interactionBySession);
    return (
      <SessionContextMenu
        key={session.id}
        session={session}
        onRename={() => {
          setRenamingId(session.id);
          setRenameValue(session.title);
        }}
      >
        <button
          type="button"
          {...hoverPreview.bind(session.id, session.title)}
          onClick={() => {
            uiStore.setMode('chat');
            tabStore.openChatTab(session.id, session.title);
          }}
          className={cn(
            'group flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] leading-5 text-ink/75 outline-none transition-colors focus-visible:inset-ring-2 focus-visible:inset-ring-ink/30 hover:bg-[var(--sidebar-hover)] hover:text-ink',
            active && 'bg-[var(--sidebar-selected)] font-medium text-ink hover:bg-[var(--sidebar-selected)]',
          )}
        >
          <SessionStatus pending={!!pendingKind} unread={!!unreadBySession[session.id]} running={!!sendingBySession[session.id]} />
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
                <span className="truncate text-[11px] leading-tight text-ink-muted/80">{session.listPreview}</span>
              )}
            </span>
          )}
          {pendingKind && <PendingInteractionBadge kind={pendingKind} />}
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void deleteWithUndo(session.id, session.title);
            }}
            className="mt-0.5 shrink-0 self-start rounded p-1 text-ink-muted opacity-0 transition-opacity duration-[140ms] hover:bg-paper hover:text-danger group-hover:opacity-100"
            aria-label="删除会话"
          >
            <Trash2 size={13} />
          </span>
        </button>
      </SessionContextMenu>
    );
  };

  return (
    <aside
      ref={asideRef}
      data-ui="app.sidebar"
      className={cn(
        'relative flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--sidebar-line)] bg-sidebar',
        isDragging
          ? 'transition-none select-none'
          : 'transition-[width] duration-[var(--duration-base)] ease-[var(--ease-drawer)] motion-reduce:transition-none',
        collapsed && 'border-r-0',
      )}
      style={{ width: collapsed ? 0 : sidebarWidth }}
    >
      <div
        className="anim-fade flex h-full w-full min-w-0 flex-col overflow-hidden px-3 pb-3 pt-3"
        style={collapsed ? { display: 'none' } : undefined}
      >
        <nav className="flex flex-col gap-1" aria-label="Studio 导航">
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
      </nav>

      <div className="mt-7 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-1">
          <button type="button" onClick={toggleChatsOpen} className={cn(foldRow, 'flex-1')} aria-expanded={chatsOpen}>
            <ChevronRight
              size={14}
              className={cn(
                'shrink-0 transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
                chatsOpen && 'rotate-90',
              )}
            />
            对话
          </button>
          <button
            type="button"
            onClick={() => {
              uiStore.setMode('chat');
              tabStore.newLauncherTab();
            }}
            title="开启新对话"
            aria-label="开启新对话"
            className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted outline-none transition-colors hover:bg-[var(--sidebar-hover)] hover:text-ink focus-visible:inset-ring-2 focus-visible:inset-ring-ink/30"
          >
            <Plus size={14} />
          </button>
        </div>
        {chatsOpen && (
          <nav className="anim-fade min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 pb-2">
            {pinnedVisible.length > 0 && (
              <div className="pb-1">
                <p className="px-3 pb-0.5 pt-1 text-[11px] text-ink-muted">置顶</p>
                {pinnedVisible.map(renderSession)}
              </div>
            )}
            {folderGroups.groups.length === 0 && folderGroups.loose.length === 0 && pinnedVisible.length === 0 && !q && (
              <p className="px-3 py-1.5 text-xs text-ink-muted">暂无会话</p>
            )}
            {folderGroups.groups.map((group) => {
              const key = folderKey(group.path);
              const open = isFolderOpen(key);
              const current = !!workspacePath && samePath(group.path, workspacePath);
              return (
                <div key={key}>
                  <div className="group/folder flex items-center">
                    <button
                      type="button"
                      onClick={() => toggleFolder(key)}
                      aria-expanded={open}
                      title={group.path}
                      className={cn(
                        'flex min-w-0 items-center gap-1 px-3 py-2 text-left text-[13px] leading-5 outline-none transition-colors hover:text-ink focus-visible:text-ink',
                        current ? 'font-medium text-ink' : 'text-ink-muted',
                      )}
                    >
                      <span className="min-w-0 truncate">{folderName(group.path)}</span>
                      <ChevronRight
                        size={13}
                        className={cn(
                          'shrink-0 transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
                          open && 'rotate-90',
                        )}
                      />
                    </button>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => void newChatInFolder(group.path)}
                      title={`在 ${folderName(group.path)} 中新建对话`}
                      aria-label={`在 ${folderName(group.path)} 中新建对话`}
                      className="mr-2 hidden size-6 shrink-0 items-center justify-center text-ink-muted hover:text-ink group-hover/folder:inline-flex"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-0.5 pl-3">
                      {group.visible.length === 0 && (
                        <p className="px-3 py-1.5 text-xs text-ink-muted">这个文件夹还没有对话</p>
                      )}
                      {group.visible.map(renderSession)}
                    </div>
                  )}
                </div>
              );
            })}
            {folderGroups.loose.map(renderSession)}
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

      <div className="shrink-0">
        {organized.archived.length > 0 && (
          <>
            <button type="button" onClick={() => setArchivedOpen((v) => !v)} className={foldRow} aria-expanded={archivedOpen || !!q}>
              <ChevronRight size={14} className={cn('shrink-0 transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none', (archivedOpen || !!q) && 'rotate-90')} />
              已归档
              <span className="text-ink-muted/70">{organized.archived.length}</span>
            </button>
            {(archivedOpen || !!q) && <div className="max-h-40 space-y-0.5 overflow-y-auto px-1">{archivedVisible.map(renderSession)}</div>}
          </>
        )}
        <button type="button" onClick={() => setTrashOpen((v) => !v)} className={foldRow} aria-expanded={trashOpen}>
          <ChevronRight size={14} className={cn('shrink-0 transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none', trashOpen && 'rotate-90')} />
          最近删除
        </button>
        {trashOpen && <div className="max-h-40 overflow-y-auto"><TrashPanel /></div>}
      </div>

      <div className="mt-3 shrink-0 border-t border-[var(--sidebar-line)] pt-3">
        <AccountControl />
      </div>
      </div>

      {!collapsed && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="group absolute -right-1.5 top-0 z-30 flex h-full w-3 cursor-col-resize items-center justify-center select-none"
          title="拖动调整侧栏宽度（继续向左滑可折叠收起）"
        >
          <span
            className={cn(
              'h-8 w-1 rounded-full bg-line opacity-0 transition-opacity group-hover:opacity-100',
              isDragging && 'opacity-100 bg-accent',
            )}
          />
        </div>
      )}

      {hoverPreview.card}
    </aside>
  );
}
