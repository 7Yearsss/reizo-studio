import { Copy, MessageSquare, Plus, X, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { useTabStore } from '../../state/useTabStore';
import { useUiStore } from '../../state/useUiStore';
import * as tabStore from '../../state/tabStore';
import * as uiStore from '../../state/uiStore';
import Tooltip from '../ui/Tooltip';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../motion/context-menu';
import { toast } from '../../lib/toast';

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const mode = useUiStore((s) => s.mode);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 px-2">
      <div className="titlebar-no-drag flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {tabs
          .filter((tab) => tab.kind === 'launcher' || tab.kind === 'chat')
          .map((tab) => {
            const active = mode === 'chat' && tab.id === activeTabId;
            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger>
                  <button
                    type="button"
                    onClick={() => {
                      uiStore.setMode('chat');
                      tabStore.selectTab(tab.id);
                    }}
                    className={cn(
                      'titlebar-no-drag group relative flex max-w-[200px] min-w-[120px] items-center gap-1.5 rounded-t-md px-3 py-1.5 text-[13px] transition-colors duration-150',
                      active ? 'text-ink font-medium' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="active-tab-surface"
                        className="absolute inset-0 rounded-t-md bg-paper shadow-[0_-1px_3px_rgba(0,0,0,0.03)]"
                        transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                      />
                    )}
                    <MessageSquare size={12} className="relative z-10 shrink-0 opacity-70" />
                    <span className="relative z-10 flex-1 truncate text-left">{tab.title}</span>
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        tabStore.closeTab(tab.id);
                      }}
                      className="relative z-10 rounded p-0.5 opacity-0 hover:bg-paper-inset group-hover:opacity-100 transition-opacity"
                      aria-label="关闭标签"
                    >
                      <X size={11} />
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-44 rounded-xl border border-line bg-paper-raised p-1 shadow-xl">
                  <ContextMenuItem onSelect={() => tabStore.closeTab(tab.id)} tone="destructive">
                    <span className="flex items-center gap-2">
                      <X size={13} /> 关闭标签
                    </span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      tabs
                        .filter((t) => t.id !== tab.id && (t.kind === 'launcher' || t.kind === 'chat'))
                        .forEach((t) => tabStore.closeTab(t.id));
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <XCircle size={13} /> 关闭其他标签
                    </span>
                  </ContextMenuItem>
                  <ContextMenuSeparator className="my-1 h-px bg-line" />
                  <ContextMenuItem
                    onSelect={() => {
                      void navigator.clipboard.writeText(tab.title);
                      toast.success('已复制标签标题');
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Copy size={13} /> 复制标题
                    </span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
      </div>
      <Tooltip content="开始创作" side="bottom">
        <button
          type="button"
          className="titlebar-no-drag shrink-0 rounded-md p-1.5 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
          onClick={() => {
            uiStore.setMode('chat');
            tabStore.newLauncherTab();
          }}
          aria-label="新建标签"
        >
          <Plus size={14} />
        </button>
      </Tooltip>
      {/* Empty titlebar space stays in the drag region so the window can be moved. */}
      <div className="h-full min-w-10 flex-1" aria-hidden />
    </div>
  );
}
