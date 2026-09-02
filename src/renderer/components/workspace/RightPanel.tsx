import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import * as uiStore from '../../state/uiStore';
import { useUiStore } from '../../state/useUiStore';
import DirectoryPanel from './DirectoryPanel';
import GitPanel from './GitPanel';
import TerminalPanel from './TerminalPanel';
import ArtifactPanel from './ArtifactPanel';
import CanvasPanel from '../canvas/CanvasPanel';

type PanelTab = 'canvas' | 'artifacts' | 'files' | 'git' | 'terminal';

const LABELS: Record<PanelTab, string> = {
  canvas: '画布',
  artifacts: '作品',
  files: '文件',
  git: 'Git',
  terminal: '终端',
};

export default function RightPanel({
  sessionId,
  showWorkspace,
  preferCanvas,
}: {
  sessionId?: string;
  showWorkspace?: boolean;
  preferCanvas?: boolean;
}) {
  const workspace = Boolean(showWorkspace);
  const storedWidth = useUiStore((s) => s.rightPanelWidth);
  const maximized = useUiStore((s) => s.rightPanelMaximized);
  const width = maximized ? Math.min(1200, Math.round(window.innerWidth * 0.78)) : storedWidth;
  const visible: PanelTab[] = [
    ...(sessionId ? (['canvas', 'artifacts'] as const) : []),
    ...(workspace ? (['files', 'git', 'terminal'] as const) : []),
  ];
  const [tab, setTab] = useState<PanelTab>(
    preferCanvas && sessionId ? 'canvas' : sessionId ? 'artifacts' : visible[0] ?? 'files',
  );
  const active = visible.includes(tab) ? tab : visible[0];

  // When the agent auto-opens the canvas, surface that tab.
  useEffect(() => {
    if (preferCanvas && sessionId) setTab('canvas');
  }, [preferCanvas, sessionId]);

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

  if (visible.length === 0) return null;

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
      <div className="flex items-center gap-1 px-2 pt-2">
        {visible.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs',
              active === id ? 'bg-paper text-ink' : 'text-ink-muted hover:bg-paper-inset/70',
            )}
          >
            {LABELS[id]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => uiStore.toggleRightPanelMaximized()}
            className="rounded-full p-1.5 text-ink-muted hover:bg-paper-inset/70"
            title={maximized ? '还原宽度' : '最大化面板'}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {sessionId && (
            <button
              type="button"
              onClick={() => {
                uiStore.setCanvasOpen(false);
                uiStore.setArtifactsOpen(false);
              }}
              className="rounded-full p-1.5 text-ink-muted hover:bg-paper-inset/70"
              title="关闭面板"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {active === 'canvas' && sessionId && <CanvasPanel key={sessionId} sessionId={sessionId} />}
        {active === 'artifacts' && sessionId && <ArtifactPanel sessionId={sessionId} />}
        {active === 'files' && workspace && <DirectoryPanel embedded />}
        {active === 'git' && workspace && <GitPanel />}
        {active === 'terminal' && workspace && <TerminalPanel />}
      </div>
    </aside>
  );
}
