import { useState } from 'react';
import { cn } from '../../lib/cn';
import DirectoryPanel from './DirectoryPanel';
import GitPanel from './GitPanel';
import TerminalPanel from './TerminalPanel';
import ArtifactPanel from './ArtifactPanel';

type PanelTab = 'artifacts' | 'files' | 'git' | 'terminal';

export default function RightPanel({
  sessionId,
  showWorkspace,
}: {
  sessionId?: string;
  showWorkspace?: boolean;
}) {
  const workspace = Boolean(showWorkspace);
  const [tab, setTab] = useState<PanelTab>(sessionId ? 'artifacts' : 'files');
  const visible: PanelTab[] = [
    ...(sessionId ? (['artifacts'] as const) : []),
    ...(workspace ? (['files', 'git', 'terminal'] as const) : []),
  ];
  const active = visible.includes(tab) ? tab : visible[0];

  if (visible.length === 0) return null;

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-line bg-sidebar">
      <div className="flex gap-1 px-2 pt-2">
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
            {id === 'artifacts' ? '作品' : id === 'files' ? '文件' : id === 'git' ? 'Git' : '终端'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {active === 'artifacts' && sessionId && <ArtifactPanel sessionId={sessionId} />}
        {active === 'files' && workspace && <DirectoryPanel embedded />}
        {active === 'git' && workspace && <GitPanel />}
        {active === 'terminal' && workspace && <TerminalPanel />}
      </div>
    </aside>
  );
}
