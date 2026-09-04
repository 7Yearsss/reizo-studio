import { useEffect, useRef, useState } from 'react';
import {
  FolderKanban,
  FolderTree,
  GitBranch,
  MoreVertical,
  Pencil,
  Search,
  Terminal,
  Trash2,
  Workflow,
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
}

export default function TopRightToolbar({
  sessionId,
  onSearch,
  searchOpen,
  onRename,
  onDelete,
  onOpenCanvas,
}: TopRightToolbarProps) {
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreOpen]);

  const handleCanvasClick = () => {
    if (onOpenCanvas) {
      onOpenCanvas();
    } else {
      uiStore.toggleRightPanelTab('canvas');
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors duration-150',
            searchOpen ? 'bg-paper-inset text-ink' : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
          )}
          title="搜索对话 (Ctrl/⌘F)"
        >
          <Search size={13} />
          搜索
        </button>
      )}
      <button
        type="button"
        onClick={handleCanvasClick}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-150',
          rightPanelTab === 'canvas'
            ? 'bg-accent/15 text-accent border border-accent/30'
            : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
        )}
        title="画布视窗"
      >
        <Workflow size={13} />
        画布
      </button>
      <button
        type="button"
        onClick={() => uiStore.toggleRightPanelTab('terminal')}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150',
          rightPanelTab === 'terminal'
            ? 'bg-paper-inset text-ink shadow-sm'
            : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
        )}
        title="终端控制台"
      >
        <Terminal size={14} />
      </button>
      <button
        type="button"
        onClick={() => uiStore.toggleRightPanelTab('git')}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150',
          rightPanelTab === 'git'
            ? 'bg-paper-inset text-ink shadow-sm'
            : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
        )}
        title="Git 变更"
      >
        <GitBranch size={14} />
      </button>
      <div className="relative" ref={moreMenuRef}>
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150',
            moreOpen || rightPanelTab === 'files' || rightPanelTab === 'artifacts'
              ? 'bg-paper-inset text-ink'
              : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
          )}
          title="更多面板与操作"
        >
          <MoreVertical size={14} />
        </button>
        {moreOpen && (
          <div className="absolute right-0 top-full mt-1.5 z-30 w-44 overflow-hidden rounded-xl border border-line bg-paper-raised/95 py-1 text-xs shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
            <button
              type="button"
              onClick={() => {
                uiStore.toggleRightPanelTab('files');
                setMoreOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-paper-inset/70',
                rightPanelTab === 'files' ? 'font-medium text-ink' : 'text-ink-muted',
              )}
            >
              <FolderTree size={13} />
              <span>工作区文件</span>
              {rightPanelTab === 'files' && <span className="ml-auto text-[10px] text-accent">●</span>}
            </button>
            {sessionId && (
              <button
                type="button"
                onClick={() => {
                  uiStore.toggleRightPanelTab('artifacts');
                  setMoreOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-paper-inset/70',
                  rightPanelTab === 'artifacts' ? 'font-medium text-ink' : 'text-ink-muted',
                )}
              >
                <FolderKanban size={13} />
                <span>会话作品</span>
                {rightPanelTab === 'artifacts' && <span className="ml-auto text-[10px] text-accent">●</span>}
              </button>
            )}
            {(onRename || onDelete) && <div className="my-1 border-t border-line/60" />}
            {onRename && (
              <button
                type="button"
                onClick={() => {
                  onRename();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-muted transition-colors hover:bg-paper-inset/70 hover:text-ink"
              >
                <Pencil size={13} />
                <span>重命名对话</span>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger/90 transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 size={13} />
                <span>删除对话</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
