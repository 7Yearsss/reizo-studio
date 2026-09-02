import { useEffect, useRef, useState } from 'react';
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
  const width = useUiStore((s) => s.rightPanelWidth);
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
    if (!dragging.current) return;
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
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
        title="拖动调整宽度"
      />
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
        {sessionId && (
          <button
            type="button"
            onClick={() => uiStore.setCanvasOpen(false)}
            className="ml-auto rounded-full px-2 py-1 text-xs text-ink-muted hover:bg-paper-inset/70"
            title="关闭面板"
          >
            ✕
          </button>
        )}
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
