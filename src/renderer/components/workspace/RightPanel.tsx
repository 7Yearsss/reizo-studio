import { useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { createPortal } from 'react-dom';
import { useTitleBarSlot } from '../layout/titleBarSlots';
import * as uiStore from '../../state/uiStore';
import { useUiStore } from '../../state/useUiStore';
import DirectoryPanel from './DirectoryPanel';
import GitPanel from './GitPanel';
import TerminalPanel from './TerminalPanel';
import ArtifactPanel from './ArtifactPanel';
import CanvasPanel from '../canvas/CanvasPanel';
import Tooltip from '../ui/Tooltip';



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
  const rightSlot = useTitleBarSlot('right');
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
          Math.min(maxAvailable - uiStore.CHAT_PANEL_MIN, window.innerWidth - e.clientX),
        );
        uiStore.setRightPanelWidth(restoredWidth);
      }
      return;
    }

    const calculatedWidth = startWidth.current + delta;
    const remainingChatWidth = maxAvailable - calculatedWidth;

    // Check snap to maximize: dragging close to the left edge / remaining chat < 240px
    if (remainingChatWidth < 240 || e.clientX < currentSidebarW + 240) {
      uiStore.setRightPanelMaximized(true);
      return;
    }

    if (maximized && remainingChatWidth >= 240) {
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

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col bg-sidebar',
        maximized
          ? 'flex-1 w-full'
          : 'shrink-0 self-stretch my-2 mr-2 !h-auto rounded-xl border border-line/70 overflow-hidden shadow-sm',
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
      {/* Panel chrome lives in the window title bar (right slot) — keeps a single top row */}
      {rightSlot &&
        createPortal(
          <div className="ml-1 flex items-center gap-0.5 border-l border-line/60 pl-1.5">
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
            </div>,
          rightSlot,
        )}
      {/* Maximize floats inside the panel corner — the title bar only carries close */}
      <Tooltip content={maximized ? '还原宽度' : '最大化面板'} side="left">
        <button
          type="button"
          onClick={() => uiStore.toggleRightPanelMaximized()}
          className="absolute bottom-3 right-3 z-30 rounded-full bg-paper-raised/80 p-1.5 text-ink-muted shadow-sm backdrop-blur-sm transition-colors hover:bg-paper-inset hover:text-ink"
          aria-label={maximized ? '还原宽度' : '最大化面板'}
        >
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </Tooltip>
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
