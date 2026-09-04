import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Minus,
  PanelLeft,
  Search,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import TabBar from './TabBar';
import Tooltip from '../ui/Tooltip';
import logoUrl from '../../assets/logo.png';
import { useUiStore } from '../../state/useUiStore';
import { useTabStore } from '../../state/useTabStore';
import * as uiStore from '../../state/uiStore';
import {
  goBack,
  goForward,
  recordNav,
  useNavHistory,
} from '../../state/navHistory';
import { openGlobalCommandPalette } from './GlobalCommandPalette';
import { cn } from '../../lib/cn';

const isWindows = typeof window !== 'undefined' && window.reizo?.platform === 'win32';

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export default function CustomTitleBar() {
  const [maximized, setMaximized] = useState(false);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const mode = useUiStore((s) => s.mode);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const { canGoBack, canGoForward } = useNavHistory();
  const searchModHint = isMacPlatform() ? '⌘K' : 'Ctrl+K';
  const sidebarModHint = isMacPlatform() ? '⌘B' : 'Ctrl+B';

  useEffect(() => {
    void window.reizo?.windowIsMaximized?.().then((val) => {
      if (typeof val === 'boolean') setMaximized(val);
    });
  }, []);

  // Track navigation location changes
  useEffect(() => {
    recordNav({ mode, tabId: mode === 'chat' ? activeTabId : undefined });
  }, [mode, activeTabId]);

  // Global titlebar shortcuts: Ctrl+B toggle sidebar, Alt+Left/Right back/forward
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        uiStore.toggleSidebar();
        return;
      }

      if (e.altKey && e.key === 'ArrowLeft' && !isTyping) {
        e.preventDefault();
        goBack();
        return;
      }

      if (e.altKey && e.key === 'ArrowRight' && !isTyping) {
        e.preventDefault();
        goForward();
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="titlebar flex h-10 shrink-0 items-center bg-sidebar border-b border-line/70 select-none">
      {/* Claude-style top-left toolbar: Logo, Sidebar toggle, Quick search, Back/Forward */}
      <div
        className={cn(
          'flex h-full shrink-0 items-center border-r border-line/70 px-3 bg-sidebar transition-[width] duration-[var(--duration-base)] ease-[var(--ease-drawer)] motion-reduce:transition-none',
          sidebarCollapsed ? 'w-auto' : 'w-[248px]',
        )}
      >
        <div className="titlebar-no-drag flex items-center gap-1">
          <Tooltip content="Reizo Studio" side="bottom">
            <div className="flex h-7 w-7 items-center justify-center">
              <img
                src={logoUrl}
                alt="Reizo"
                className="h-5 w-5 object-contain select-none"
                draggable={false}
              />
            </div>
          </Tooltip>

          <Tooltip content={sidebarCollapsed ? `展开侧栏 (${sidebarModHint})` : `收起侧栏 (${sidebarModHint})`} side="bottom">
            <button
              type="button"
              onClick={() => uiStore.toggleSidebar()}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-paper-inset hover:text-ink',
                sidebarCollapsed ? 'text-ink-muted' : 'text-ink',
              )}
              aria-label="切换侧栏"
            >
              <PanelLeft size={15} strokeWidth={1.8} />
            </button>
          </Tooltip>

          <Tooltip content={`快速搜索 (${searchModHint})`} side="bottom">
            <button
              type="button"
              onClick={() => openGlobalCommandPalette()}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink"
              aria-label="快速搜索"
            >
              <Search size={15} strokeWidth={1.8} />
            </button>
          </Tooltip>

          <div className="mx-0.5 h-3.5 w-px bg-line/60" />

          <Tooltip content="后退 (Alt+←)" side="bottom">
            <button
              type="button"
              disabled={!canGoBack}
              onClick={() => goBack()}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
              aria-label="后退"
            >
              <ArrowLeft size={15} strokeWidth={1.8} />
            </button>
          </Tooltip>

          <Tooltip content="前进 (Alt+→)" side="bottom">
            <button
              type="button"
              disabled={!canGoForward}
              onClick={() => goForward()}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
              aria-label="前进"
            >
              <ArrowRight size={15} strokeWidth={1.8} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Main Tabs */}
      <TabBar />

      {/* Windows Window Controls */}
      {isWindows && (
        <div className="titlebar-no-drag ml-auto flex h-full">
          <button
            className="flex w-11 items-center justify-center text-ink-muted hover:bg-paper-inset hover:text-ink"
            onClick={() => void window.reizo?.windowMinimize?.()}
            aria-label="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            className="flex w-11 items-center justify-center text-ink-muted hover:bg-paper-inset hover:text-ink"
            onClick={async () => {
              const next = await window.reizo?.windowToggleMaximize?.();
              if (typeof next === 'boolean') setMaximized(next);
            }}
            aria-label={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button
            className="flex w-11 items-center justify-center text-ink-muted hover:bg-danger hover:text-white"
            onClick={() => void window.reizo?.windowClose?.()}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </header>
  );
}
