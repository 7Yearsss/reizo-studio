import { useState } from 'react';
import { cn } from '../../lib/cn';
import DirectoryPanel from './DirectoryPanel';
import GitPanel from './GitPanel';
import TerminalPanel from './TerminalPanel';

export default function RightPanel() {
  const [tab, setTab] = useState<'files' | 'git' | 'terminal'>('files');

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-line bg-sidebar">
      <div className="flex gap-1 px-2 pt-2">
        {(['files', 'git', 'terminal'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs',
              tab === id ? 'bg-paper text-ink' : 'text-ink-muted hover:bg-paper-inset/70',
            )}
          >
            {id === 'files' ? '文件' : id === 'git' ? 'Git' : '终端'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'files' && <DirectoryPanel embedded />}
        {tab === 'git' && <GitPanel />}
        {tab === 'terminal' && <TerminalPanel />}
      </div>
    </aside>
  );
}
