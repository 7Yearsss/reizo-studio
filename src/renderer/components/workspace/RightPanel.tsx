import { useRef } from 'react';
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
import { motion } from 'motion/react';
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
  const width = maximized ? Math.min(1200, Math.round(window.innerWidth * 0.78)) : storedWidth;

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || maximized) return;
    uiStore.setRightPanelWidth(startWidth.current + (startX.current - e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-line bg-sidebar"
      style={{ width }}
    >
      {!maximized && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="group absolute -left-1 top-0 z-10 flex h-full w-2 cursor-col-resize items-center justify-center"
          title="拖动调整宽度"
        >
          <span className="h-8 w-1 rounded-full bg-line opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      )}
      <div className="flex h-10 items-center justify-between border-b border-line/60 px-2.5">
        <div className="flex items-center gap-0.5">
          {(Object.keys(PANEL_METAS) as uiStore.RightPanelTab[]).map((tabKey) => {
            const item = PANEL_METAS[tabKey];
            const ItemIcon = item.icon;
            const active = activeTab === tabKey;
            return (
              <Tooltip key={tabKey} content={item.label} side="bottom">
                <button
                  type="button"
                  onClick={() => uiStore.setRightPanelTab(tabKey)}
                  className={cn(
                    'relative flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors duration-150',
                    active ? 'font-medium text-ink' : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="right-panel-tab-active"
                      className="absolute inset-0 rounded-lg bg-paper-raised shadow-xs"
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <ItemIcon
                    size={13}
                    className={cn(
                      'relative z-10',
                      active ? (tabKey === 'canvas' ? 'text-accent' : 'text-ink') : 'opacity-70',
                    )}
                  />
                  {active && <span className="relative z-10 text-[11px]">{item.label}</span>}
                </button>
              </Tooltip>
            );
          })}
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
