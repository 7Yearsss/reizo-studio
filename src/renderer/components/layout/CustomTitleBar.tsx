import { Minus, Square, Copy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import TabBar from './TabBar';

const isWindows = typeof window !== 'undefined' && window.reizo?.platform === 'win32';
const isMac = typeof window !== 'undefined' && window.reizo?.platform === 'darwin';

export default function CustomTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.reizo.windowIsMaximized().then(setMaximized);
  }, []);

  return (
    <header className="titlebar flex h-10 shrink-0 items-stretch bg-sidebar">
      {isMac && <div className="w-[76px] shrink-0" />}
      <TabBar />
      {isWindows && (
        <div className="titlebar-no-drag ml-auto flex">
          <button
            className="flex w-11 items-center justify-center text-ink-muted hover:bg-paper-inset hover:text-ink"
            onClick={() => void window.reizo.windowMinimize()}
            aria-label="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            className="flex w-11 items-center justify-center text-ink-muted hover:bg-paper-inset hover:text-ink"
            onClick={async () => setMaximized(await window.reizo.windowToggleMaximize())}
            aria-label={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button
            className="flex w-11 items-center justify-center text-ink-muted hover:bg-danger hover:text-white"
            onClick={() => void window.reizo.windowClose()}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </header>
  );
}
