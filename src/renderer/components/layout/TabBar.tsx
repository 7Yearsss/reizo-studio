import { MessageSquare, Plus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useTabStore } from '../../state/useTabStore';
import { useUiStore } from '../../state/useUiStore';
import * as tabStore from '../../state/tabStore';
import * as uiStore from '../../state/uiStore';

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const mode = useUiStore((s) => s.mode);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 px-2">
      <div className="titlebar-no-drag flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {tabs.filter((tab) => tab.kind === 'launcher' || tab.kind === 'chat').map((tab) => {
          const active = mode === 'chat' && tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                uiStore.setMode('chat');
                tabStore.selectTab(tab.id);
              }}
              title={tab.title}
              className={cn(
                'titlebar-no-drag group relative flex max-w-[200px] min-w-[120px] items-center gap-1.5 rounded-t-md px-3 py-1.5 text-[13px] transition-colors duration-200',
                active ? 'bg-paper text-ink' : 'text-ink-muted hover:bg-paper-inset/70 hover:text-ink',
              )}
            >
              <MessageSquare size={12} className="shrink-0 opacity-70" />
              <span className="flex-1 truncate text-left">{tab.title}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  tabStore.closeTab(tab.id);
                }}
                className="rounded p-0.5 opacity-0 hover:bg-paper-inset group-hover:opacity-100"
                aria-label="关闭标签"
              >
                <X size={11} />
              </span>
              {active && (
                <span className="pointer-events-none absolute inset-x-4 bottom-0 h-[2px] rounded-full bg-accent/80" />
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="titlebar-no-drag shrink-0 rounded-md p-1.5 text-ink-muted hover:bg-paper-inset hover:text-ink"
        onClick={() => {
          uiStore.setMode('chat');
          tabStore.newLauncherTab();
        }}
        aria-label="新建标签"
        title="开始创作"
      >
        <Plus size={14} />
      </button>
      {/* Empty titlebar space stays in the drag region so the window can be moved. */}
      <div className="h-full min-w-10 flex-1" aria-hidden />
    </div>
  );
}
