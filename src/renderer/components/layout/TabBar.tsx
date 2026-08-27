import { MessageSquare, Plug, Plus, Settings, Timer, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useTabStore } from '../../state/useTabStore';
import * as tabStore from '../../state/tabStore';

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 px-2">
      <div className="titlebar-no-drag flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => tabStore.selectTab(tab.id)}
              className={cn(
                'group flex max-w-[200px] min-w-[120px] items-center gap-1.5 rounded-t-md px-3 py-1.5 text-[13px]',
                active ? 'bg-paper text-ink' : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
              )}
            >
              {tab.kind === 'settings' ? (
                <Settings size={12} className="shrink-0 opacity-70" />
              ) : tab.kind === 'automation' ? (
                <Timer size={12} className="shrink-0 opacity-70" />
              ) : tab.kind === 'plugins' ? (
                <Plug size={12} className="shrink-0 opacity-70" />
              ) : (
                <MessageSquare size={12} className="shrink-0 opacity-70" />
              )}
              <span className="flex-1 truncate text-left">{tab.title}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  tabStore.closeTab(tab.id);
                }}
                className="rounded p-0.5 opacity-0 hover:bg-paper-inset group-hover:opacity-100"
                aria-label="Close tab"
              >
                <X size={11} />
              </span>
            </button>
          );
        })}
      </div>
      <button
        className="titlebar-no-drag mr-2 rounded-md p-1.5 text-ink-muted hover:bg-paper-inset hover:text-ink"
        onClick={() => tabStore.newLauncherTab()}
        aria-label="New tab"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
