import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { motion, useIsPresent } from 'motion/react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { createPortal } from 'react-dom';
import { useTitleBarSlot } from '../layout/titleBarSlots';
import * as uiStore from '../../state/uiStore';
import { useUiStore } from '../../state/useUiStore';
import DirectoryPanel from './DirectoryPanel';
import GitPanel from './GitPanel';
import TerminalPanel from './TerminalPanel';
import Tooltip from '../ui/Tooltip';
import CanvasSkeleton from '../canvas/CanvasSkeleton';

// Heavy panels are code-split so the drawer shell never waits on their bundle.
const CanvasPanel = lazy(() => import('../canvas/CanvasPanel'));
const ArtifactPanel = lazy(() => import('./ArtifactPanel'));

const PANEL_DURATION = 0.22;
const PANEL_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
// Fallback in case onAnimationComplete never fires (e.g. AnimatePresence initial={false}).
const CONTENT_READY_FALLBACK_MS = PANEL_DURATION * 1000 + 40;


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
  const [contentReady, setContentReady] = useState(false);
  const isPresent = useIsPresent();
  useEffect(() => {
    const t = window.setTimeout(() => setContentReady(true), CONTENT_READY_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, []);
  const showContent = contentReady && isPresent;
  const rightSlot = useTitleBarSlot('right');
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const wasMaximizedAtStart = useRef(false);
  const asideRef = useRef<HTMLElement>(null);
  const dragWidth = useRef<number | null>(null);

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
      dragWidth.current = null;
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

    // Resize by mutating the DOM node directly — committing through the store
    // on every pointermove re-renders the panel each frame and stalls on long
    // message lists. The store (and localStorage) sees one write on release.
    const clamped = Math.min(
      uiStore.getRightPanelMax(),
      Math.max(uiStore.RIGHT_PANEL_MIN, Math.round(calculatedWidth)),
    );
    dragWidth.current = clamped;
    if (asideRef.current) asideRef.current.style.width = `${clamped}px`;
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
    if (dragWidth.current !== null) {
      uiStore.setRightPanelWidth(dragWidth.current);
      dragWidth.current = null;
    }
  };

  return (
    <motion.aside
      ref={asideRef}
      initial={{ width: 0, opacity: 0, x: 24 }}
      animate={{ width: maximized ? '100%' : storedWidth, opacity: 1, x: 0 }}
      exit={{ width: 0, opacity: 0, x: 24 }}
      transition={
        isDragging
          ? { duration: 0 }
          : { duration: PANEL_DURATION, ease: PANEL_EASE }
      }
      onAnimationComplete={() => setContentReady(true)}
      style={{ willChange: isDragging ? undefined : 'width, transform, opacity' }}
      className={cn(
        'relative flex h-full flex-col overflow-hidden bg-sidebar',
        maximized
          ? 'w-full'
          : 'shrink-0 self-stretch my-2 mr-2 !h-auto rounded-xl border border-line/70 shadow-sm',
        isDragging && 'select-none',
      )}
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
      <div className="min-h-0 flex-1 bg-sidebar">
        {activeTab === 'canvas' &&
          (showContent && sessionId ? (
            <Suspense fallback={<CanvasSkeleton />}>
              <div key={sessionId} className="h-full w-full animate-[fade-in_180ms_var(--ease-out)]">
                <CanvasPanel sessionId={sessionId} />
              </div>
            </Suspense>
          ) : (
            <CanvasSkeleton />
          ))}
        {showContent && (
          <>
            {activeTab === 'artifacts' && sessionId && (
              <Suspense fallback={null}>
                <ArtifactPanel sessionId={sessionId} />
              </Suspense>
            )}
            {activeTab === 'files' && <DirectoryPanel embedded />}
            {activeTab === 'git' && <GitPanel />}
            {activeTab === 'terminal' && <TerminalPanel />}
          </>
        )}
      </div>
    </motion.aside>
  );
}
