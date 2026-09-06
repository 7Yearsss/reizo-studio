import { useRef, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  X,
  Workflow,
  FolderKanban,
  FolderTree,
  GitBranch,
  Terminal,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import * as uiStore from '../../state/uiStore';
import { useUiStore } from '../../state/useUiStore';
import DirectoryPanel from './DirectoryPanel';
import GitPanel from './GitPanel';
import TerminalPanel from './TerminalPanel';
import ArtifactPanel from './ArtifactPanel';
import CanvasPanel from '../canvas/CanvasPanel';
import Tooltip from '../ui/Tooltip';

const PANEL_METAS: Record<
  uiStore.RightPanelTab,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  canvas: { label: '画布', icon: Workflow },
  artifacts: { label: '作品', icon: FolderKanban },
  files: { label: '文件', icon: FolderTree },
  git: { label: 'Git', icon: GitBranch },
  terminal: { label: '终端', icon: Terminal },
};

export default function RightPanel({
  sessionId,
  activeTab,
}: {
  sessionId?: string;
  activeTab: uiStore.RightPanelTab;
}) {
  const storedWidth = useUiStore((s) => s.rightPanelWidth);
  const maximized = useUiStore((s) => s.rightPanelMaximized);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);

  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const wasMaximizedAtStart = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    wasMaximizedAtStart.current = maximized;
    const currentSidebarW = sidebarCollapsed ? 0 : sidebarWidth;
    const maxAvailable = window.innerWidth - currentSidebarW;
    startWidth.current = maximized ? maxAvailable : storedWidth;
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const currentSidebarW = sidebarCollapsed ? 0 : sidebarWidth;
    const maxAvailable = window.innerWidth - currentSidebarW;
    const delta = startX.current - e.clientX; // positive when dragging left

    if (wasMaximizedAtStart.current) {
      if (delta < -30) {
        wasMaximizedAtStart.current = false;
        uiStore.setRightPanelMaximized(false);
        const restoredWidth = Math.max(
          uiStore.RIGHT_PANEL_MIN,
          Math.min(maxAvailable - 220, window.innerWidth - e.clientX),
        );
        uiStore.setRightPanelWidth(restoredWidth);
      }
      return;
    }

    const calculatedWidth = startWidth.current + delta;
    const remainingChatWidth = maxAvailable - calculatedWidth;

    // Check snap to maximize: dragging close to the left edge / remaining chat < 220px
    if (remainingChatWidth < 220 || e.clientX < currentSidebarW + 220) {
      uiStore.setRightPanelMaximized(true);
      return;
    }

    if (maximized && remainingChatWidth >= 220) {
      uiStore.setRightPanelMaximized(false);
    }

    // Check snap to close: dragging far right
    if (calculatedWidth < 180) {
      uiStore.closeRightPanel();
      dragging.current = false;
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    uiStore.setRightPanelWidth(calculatedWidth);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const meta = PANEL_METAS[activeTab];
  const Icon = meta?.icon;

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col bg-sidebar',
        maximized ? 'flex-1 w-full border-l-0' : 'shrink-0 border-l border-line',
        isDragging
          ? 'transition-none select-none'
          : 'transition-[width] duration-[var(--duration-base)] ease-[var(--ease-drawer)] motion-reduce:transition-none',
      )}
      style={maximized ? undefined : { width: storedWidth }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="group absolute -left-1.5 top-0 z-30 flex h-full w-3 cursor-col-resize items-center justify-center select-none"
        title={maximized ? '向右拖动还原' : '拖动调整宽度（向左滑到底可最大化）'}
      >
        <span
          className={cn(
            'h-8 w-1 rounded-full bg-line opacity-0 transition-opacity group-hover:opacity-100',
            isDragging && 'opacity-100 bg-accent',
          )}
        />
      </div>
      <div className="flex h-10 items-center justify-between border-b border-line/60 px-3">
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon
              size={14}
              className={cn(activeTab === 'canvas' ? 'text-accent' : 'text-ink-muted')}
            />
          )}
          <span className="text-xs font-semibold text-ink">{meta?.label}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip content={maximized ? '还原宽度' : '最大化面板'} side="bottom">
            <button
              type="button"
              onClick={() => uiStore.toggleRightPanelMaximized()}
              className="rounded-full p-1.5 text-ink-muted hover:bg-paper-inset/70 hover:text-ink transition-colors"
              aria-label={maximized ? '还原宽度' : '最大化面板'}
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </Tooltip>
          <Tooltip content="关闭面板" side="bottom">
            <button
              type="button"
              onClick={() => uiStore.closeRightPanel()}
              className="rounded-full p-1.5 text-ink-muted hover:bg-paper-inset/70 hover:text-ink transition-colors"
              aria-label="关闭面板"
            >
              <X size={13} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === 'canvas' && sessionId && <CanvasPanel key={sessionId} sessionId={sessionId} />}
        {activeTab === 'artifacts' && sessionId && <ArtifactPanel sessionId={sessionId} />}
        {activeTab === 'files' && <DirectoryPanel embedded />}
        {activeTab === 'git' && <GitPanel />}
        {activeTab === 'terminal' && <TerminalPanel />}
      </div>
    </aside>
  );
}
