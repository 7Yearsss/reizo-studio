import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Check,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  FolderTree,
  GitBranch,
  MoreVertical,
  PanelRight,
  Pencil,
  Presentation,
  Search,
  Terminal,
  Trash2,
  Workflow,
  Film,
} from 'lucide-react';
import * as uiStore from '../../state/uiStore';
import { useUiStore } from '../../state/useUiStore';
import { cn } from '../../lib/cn';

export interface TopRightToolbarProps {
  sessionId?: string;
  onSearch?: () => void;
  searchOpen?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onOpenCanvas?: () => void;
  /** Called for session-bound panels when there is no session yet; should create one and open the tab. */
  onOpenPanel?: (tab: uiStore.RightPanelTab) => void;
  compact?: boolean;
}

interface PanelEntry {
  tab: uiStore.RightPanelTab;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  /** Needs a chat session (disabled in the menu without one, except where onOpenPanel can create it). */
  sessionOnly?: boolean;
}

const CREATE_PANELS: PanelEntry[] = [
  { tab: 'video', label: '视频剪辑', Icon: Film },
  { tab: 'canvas', label: '画布', Icon: Workflow },
  { tab: 'documents', label: 'Doc 文档', Icon: FileText },
  { tab: 'presentations', label: 'PPT 演示稿', Icon: Presentation },
  { tab: 'sheets', label: 'Excel 表格', Icon: FileSpreadsheet },
];

const WORKSPACE_PANELS: PanelEntry[] = [
  { tab: 'files', label: '工作区文件', Icon: FolderTree },
  { tab: 'artifacts', label: '会话作品', Icon: FolderKanban, sessionOnly: true },
  { tab: 'terminal', label: '终端', Icon: Terminal },
  { tab: 'git', label: 'Git 变更', Icon: GitBranch },
];

const ALL_PANELS = [...CREATE_PANELS, ...WORKSPACE_PANELS];

const itemClass = 'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-paper-inset';

export default function TopRightToolbar({
  sessionId,
  onSearch,
  searchOpen,
  onRename,
  onDelete,
  onOpenCanvas,
  onOpenPanel,
  compact = false,
}: TopRightToolbarProps) {
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const panelsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelsOpen && !moreOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelsRef.current && !panelsRef.current.contains(target)) setPanelsOpen(false);
      if (moreRef.current && !moreRef.current.contains(target)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPanelsOpen(false);
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [panelsOpen, moreOpen]);

  const openPanel = (entry: PanelEntry) => {
    setPanelsOpen(false);
    if (entry.tab === 'video' && rightPanelTab !== 'video') {
      const layout = uiStore.getSnapshot();
      const available = window.innerWidth - (layout.sidebarCollapsed ? 0 : layout.sidebarWidth) - uiStore.CHAT_PANEL_MIN - 8;
      uiStore.setRightPanelWidth(Math.max(uiStore.RIGHT_PANEL_MIN, Math.min(960, available)));
    }
    if (entry.tab === 'canvas' && onOpenCanvas) onOpenCanvas();
    else if (entry.tab !== 'canvas' && !sessionId && onOpenPanel && ['documents', 'presentations', 'sheets', 'video'].includes(entry.tab)) onOpenPanel(entry.tab);
    else uiStore.toggleRightPanelTab(entry.tab);
  };

  const active = ALL_PANELS.find((p) => p.tab === rightPanelTab);
  const ActiveIcon = active?.Icon ?? PanelRight;

  const renderGroup = (title: string, entries: PanelEntry[]) => (
    <div className="flex flex-col gap-0.5">
      <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium leading-4 text-ink-muted">{title}</div>
      {entries.map((entry) => {
        const on = rightPanelTab === entry.tab;
        const disabled = entry.sessionOnly && !sessionId;
        return (
          <button
            key={entry.tab}
            type="button"
            role="menuitemradio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => openPanel(entry)}
            className={cn(itemClass, on ? 'bg-paper-inset font-medium text-ink' : 'text-ink-muted hover:text-ink', disabled && 'pointer-events-none opacity-40')}
          >
            <entry.Icon size={15} />
            <span className="flex-1">{entry.label}</span>
            {on && <Check size={14} />}
          </button>
        );
      })}
    </div>
  );

  const iconButton = 'inline-flex h-8 items-center justify-center rounded-xl transition-colors duration-150';

  return (
    <div className="flex shrink-0 items-center gap-1">
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          className={cn(iconButton, 'w-8', searchOpen ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset hover:text-ink')}
          title="搜索对话 (Ctrl/⌘F)"
          aria-label="搜索对话"
        >
          <Search size={15} />
        </button>
      )}

      {/* One entry point for every right-hand panel */}
      <div className="relative" ref={panelsRef}>
        <button
          type="button"
          onClick={() => {
            setMoreOpen(false);
            setPanelsOpen((o) => !o);
          }}
          aria-haspopup="menu"
          aria-expanded={panelsOpen}
          title="打开面板"
          className={cn(
            iconButton,
            compact ? 'w-8' : 'gap-1.5 px-2.5 text-[13px]',
            panelsOpen || active ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset hover:text-ink',
          )}
        >
          <ActiveIcon size={15} />
          {!compact && <span>{active ? active.label.split(' ')[0] : '面板'}</span>}
        </button>
        {panelsOpen && (
          <div
            role="menu"
            aria-label="打开面板"
            className="absolute right-0 top-full z-30 mt-1.5 w-52 rounded-2xl bg-paper-raised p-1.5 shadow-[var(--shadow-outline),0_8px_40px_rgba(25,47,80,0.15)] animate-in fade-in zoom-in-95 duration-100"
          >
            {renderGroup('创作', CREATE_PANELS)}
            <div className="mx-2 my-1.5 h-px bg-line" />
            {renderGroup('工作区', WORKSPACE_PANELS)}
          </div>
        )}
      </div>

      {(onRename || onDelete) && (
        <div className="relative" ref={moreRef}>
          <button
            type="button"
            onClick={() => {
              setPanelsOpen(false);
              setMoreOpen((o) => !o);
            }}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title="对话操作"
            aria-label="对话操作"
            className={cn(iconButton, 'w-8', moreOpen ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset hover:text-ink')}
          >
            <MoreVertical size={15} />
          </button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1.5 w-44 rounded-2xl bg-paper-raised p-1.5 shadow-[var(--shadow-outline),0_8px_40px_rgba(25,47,80,0.15)] animate-in fade-in zoom-in-95 duration-100"
            >
              {onRename && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onRename();
                    setMoreOpen(false);
                  }}
                  className={cn(itemClass, 'text-ink-muted hover:text-ink')}
                >
                  <Pencil size={14} />
                  <span>重命名对话</span>
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onDelete();
                  }}
                  className={cn(itemClass, 'text-danger hover:bg-danger/10')}
                >
                  <Trash2 size={14} />
                  <span>删除对话</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
