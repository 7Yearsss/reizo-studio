import PanelErrorBoundary from '../PanelErrorBoundary';
import { Suspense, useEffect, useRef, useState } from 'react';
import { splitterKeyWidth } from '../../../shared/splitterKeys';
import { motion, useIsPresent } from 'motion/react';
import { Maximize2, Minimize2, PanelRightClose } from 'lucide-react';
import { cn } from '../../lib/cn';
import * as uiStore from '../../state/uiStore';
import { useUiStore } from '../../state/useUiStore';
import DirectoryPanel from './DirectoryPanel';
import GitPanel from './GitPanel';
import TerminalPanel from './TerminalPanel';
import Tooltip from '../ui/Tooltip';
import CanvasSkeleton from '../canvas/CanvasSkeleton';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { createDeferredView } from '../DeferredView';
import { setPanelResizing } from '../../lib/panelResize';
import CanvasPerformanceProbe from '../canvas/CanvasPerformanceProbe';

// Heavy panels are code-split so the drawer shell never waits on their bundle.
const CanvasPanel = lazyWithRetry(() => import('../canvas/CanvasPanel'));
const ArtifactPanel = createDeferredView<{ sessionId: string }>(() => import('./ArtifactPanel'), { label: '会话作品' });
const SheetPanel = lazyWithRetry(() => import('./SheetPanel'));
const DocumentPanel = lazyWithRetry(() => import('./DocumentPanel'));
const PresentationPanel = lazyWithRetry(() => import('./PresentationPanel'));
const VideoEditorPanel = lazyWithRetry(() => import('./VideoEditorPanel'));

const PANEL_TITLES: Record<uiStore.RightPanelTab, string> = {
  video: '视频剪辑',
  canvas: '画布',
  documents: 'Doc 文档',
  presentations: 'PPT 演示稿',
  sheets: 'Excel 表格',
  artifacts: '会话作品',
  files: '工作区文件',
  git: 'Git 变更',
  terminal: '终端',
};

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

  useEffect(() => {
    if (activeTab !== 'video' || maximized) return;
    const fitVideoPanel = () => {
      const available = window.innerWidth - (sidebarCollapsed ? 0 : sidebarWidth) - uiStore.CHAT_PANEL_MIN - 8;
      if (uiStore.getSnapshot().rightPanelWidth > available) {
        uiStore.setRightPanelWidth(Math.max(uiStore.RIGHT_PANEL_MIN, available));
      }
    };
    fitVideoPanel();
    window.addEventListener('resize', fitVideoPanel);
    return () => window.removeEventListener('resize', fitVideoPanel);
  }, [activeTab, maximized, sidebarCollapsed, sidebarWidth]);

  const [isDragging, setIsDragging] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const isPresent = useIsPresent();
  useEffect(() => {
    const t = window.setTimeout(() => setContentReady(true), CONTENT_READY_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, []);
  const showContent = contentReady && isPresent;
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const wasMaximizedAtStart = useRef(false);
  const asideRef = useRef<HTMLElement>(null);
  const dragWidth = useRef<number | null>(null);
  // Drag writes style.width behind motion's back, so its width value is still
  // the pre-drag one. The release commit must land instantly — animating it
  // would snap the edge back to the old width and slide forward again.
  const instantCommit = useRef(false);
  useEffect(() => {
    instantCommit.current = false;
  });
  useEffect(() => () => setPanelResizing(false), []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    wasMaximizedAtStart.current = maximized;
    const currentSidebarW = sidebarCollapsed ? 0 : sidebarWidth;
    const maxAvailable = window.innerWidth - currentSidebarW;
    startWidth.current = maximized ? maxAvailable : storedWidth;
    setPanelResizing(true);
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
      setPanelResizing(false);
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
      instantCommit.current = true;
      uiStore.setRightPanelWidth(dragWidth.current);
      dragWidth.current = null;
    }
    setPanelResizing(false);
  };

  return (
    <motion.aside
      ref={asideRef}
      data-ui="app.panel"
      aria-label={activeTab === 'canvas' ? '画布工作区' : '工具面板'}
      data-canvas-workspace={activeTab === 'canvas' ? '' : undefined}
      initial={{ width: 0, opacity: 0, x: 24 }}
      animate={{ width: isPresent ? (maximized ? '100%' : storedWidth) : 0, opacity: isPresent ? 1 : 0, x: isPresent ? 0 : 24 }}
      exit={{ width: 0, opacity: 0, x: 24 }}
      transition={
        isDragging || instantCommit.current
          ? { duration: 0 }
          : { duration: PANEL_DURATION, ease: PANEL_EASE }
      }
      onAnimationComplete={() => setContentReady(true)}
      style={{ willChange: isDragging ? undefined : 'width, transform, opacity' }}
      className={cn(
        'relative flex h-full flex-col overflow-hidden bg-paper-raised',
        maximized
          ? 'w-full'
          : 'shrink-0 self-stretch my-2 mr-2 !h-auto rounded-3xl shadow-[var(--shadow-panel)]',
        isDragging && 'select-none',
      )}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整面板宽度"
        aria-valuemin={uiStore.RIGHT_PANEL_MIN}
        aria-valuemax={uiStore.getRightPanelMax()}
        aria-valuenow={storedWidth}
        tabIndex={maximized ? -1 : 0}
        onKeyDown={(e) => {
          if (maximized) return;
          const next = splitterKeyWidth(storedWidth, e.key, e.shiftKey, uiStore.RIGHT_PANEL_MIN, uiStore.getRightPanelMax());
          if (next === null) return;
          e.preventDefault();
          uiStore.setRightPanelWidth(next);
        }}
        className="group absolute -left-1.5 top-0 z-30 flex h-full w-3 cursor-col-resize items-center justify-center select-none"
        title={maximized ? '向右拖动还原' : '拖动调整宽度（向左滑到底可最大化）'}
      >
        <span
          className={cn(
            'h-8 w-1 rounded-full bg-line opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-visible:bg-accent',
            isDragging && 'opacity-100 bg-accent',
          )}
        />
      </div>
      {/* The panel's own close/maximize live here, not in the window title bar: next to the
          app's close button they read as "close the app". */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-muted">{PANEL_TITLES[activeTab]}</span>
        <Tooltip content={maximized ? '还原宽度' : '最大化面板'} side="bottom">
          <button type="button" onClick={() => uiStore.toggleRightPanelMaximized()} aria-label={maximized ? '还原宽度' : '最大化面板'}
            className="inline-flex size-7 items-center justify-center rounded-[9px] text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink">
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </Tooltip>
        <Tooltip content="收起面板" side="bottom">
          <button type="button" onClick={() => uiStore.closeRightPanel()} aria-label="收起面板"
            className="inline-flex size-7 items-center justify-center rounded-[9px] text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink">
            <PanelRightClose size={14} />
          </button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 bg-paper-raised">
        <PanelErrorBoundary resetKey={`${activeTab}:${sessionId ?? ''}`}>
        {activeTab === 'canvas' &&
          (showContent && sessionId ? (
            <Suspense fallback={<CanvasSkeleton />}>
              <div key={sessionId} className="h-full w-full animate-[fade-in_180ms_var(--ease-out)]">
                <CanvasPanel key={sessionId} sessionId={sessionId} />
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
            {activeTab === 'sheets' && sessionId && <Suspense fallback={null}><SheetPanel key={sessionId} sessionId={sessionId} /></Suspense>}
            {activeTab === 'video' && sessionId && <Suspense fallback={null}><VideoEditorPanel key={sessionId} sessionId={sessionId} /></Suspense>}
            {activeTab === 'video' && !sessionId && <p className="p-6 text-sm text-ink-muted">先创建一个对话，再打开视频剪辑。</p>}
            {activeTab === 'documents' && sessionId && <Suspense fallback={null}><DocumentPanel key={sessionId} sessionId={sessionId} /></Suspense>}
            {activeTab === 'presentations' && sessionId && <Suspense fallback={null}><PresentationPanel key={sessionId} sessionId={sessionId} /></Suspense>}
            {activeTab === 'files' && <DirectoryPanel embedded />}
            {activeTab === 'git' && <GitPanel />}
            {activeTab === 'terminal' && <TerminalPanel />}
          </>
        )}
        </PanelErrorBoundary>
      </div>
      {activeTab === 'canvas' && import.meta.env.DEV && new URLSearchParams(window.location.search).has('canvas-perf') ? <CanvasPerformanceProbe key={sessionId} /> : null}
    </motion.aside>
  );
}
