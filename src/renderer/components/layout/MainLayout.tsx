import { cn } from '../../lib/cn';
import { AnimatePresence } from 'motion/react';
import { Suspense, useEffect } from 'react';
import CustomTitleBar from './CustomTitleBar';
import Sidebar from './Sidebar';
import RightPanel from '../workspace/RightPanel';
import AgentMiniPreview from '../canvas/AgentMiniPreview';
import { useTabStore } from '../../state/useTabStore';
import { useUiStore } from '../../state/useUiStore';
import * as uiStore from '../../state/uiStore';
import HomePage from '../../pages/HomePage';
import ChatPage from '../../pages/ChatPage';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import ToastContainer from '../ui/ToastContainer';
import GlobalCommandPalette from './GlobalCommandPalette';
import DiskSpaceMonitor from './DiskSpaceMonitor';
import TraceDialog from '../chat/TraceDialog';
import DeepLinkDialog from './DeepLinkDialog';
import { applyStoredCustomCss } from '../../lib/customCss';
import SettingsDialog from './SettingsDialog';

// Keep the creative workspace ready; secondary modes load their editors only
// when opened. In particular, the artifact route must not boot the sheet engine.
const AutomationPage = lazyWithRetry(() => import('../../pages/AutomationPage'));
const PluginsPage = lazyWithRetry(() => import('../../pages/PluginsPage'));
const ArtifactsPage = lazyWithRetry(() => import('../../pages/ArtifactsPage'));

function ModePageLoading({ mode }: { mode: string }) {
  const labels: Record<string, string> = { settings: '设置', automation: '自动化', skills: '技能', artifacts: '作品' };
  return <div role="status" aria-busy className="flex h-full items-center justify-center text-xs text-ink-muted">正在打开{labels[mode] || '页面'}…</div>;
}

const toggleFilesPanel = () => uiStore.toggleRightPanelTab('files');

/**
 * The full app shell: title bar, sidebar, and tab-switched main stage.
 */
export default function MainLayout() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const mode = useUiStore((s) => s.mode);
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const rightPanelMaximized = useUiStore((s) => s.rightPanelMaximized);
  useEffect(() => { applyStoredCustomCss(); }, []);
  const isChatView = mode === 'chat' || mode === 'projects';
  const showRight = isChatView && rightPanelTab !== null && (rightPanelTab !== 'canvas' || activeTab?.kind === 'chat');
  const isRightMaximized = showRight && rightPanelMaximized;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      <CustomTitleBar />
      <DiskSpaceMonitor />
      <TraceDialog />
      <DeepLinkDialog />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            isRightMaximized && 'hidden',
          )}
        >
          <div className={isChatView ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className="relative flex min-h-0 flex-1 flex-col"
                  style={active ? undefined : { display: 'none' }}
                >
                  {tab.kind === 'chat' && tab.sessionId && active && <AgentMiniPreview sessionId={tab.sessionId} canvasVisible={showRight && rightPanelTab === 'canvas'} />}
                  {tab.kind === 'launcher' && <HomePage active={active} />}
                  {tab.kind === 'chat' && tab.sessionId && (
                    <ChatPage
                      sessionId={tab.sessionId}
                      active={active}
                      onToggleTree={toggleFilesPanel}
                      treeOpen={rightPanelTab === 'files'}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {!isChatView && (
            <div className="min-h-0 min-w-0 flex-1">
              <Suspense fallback={<ModePageLoading mode={mode} />}>
              {mode === 'automation' && <AutomationPage />}
              {mode === 'skills' && <PluginsPage />}
              {mode === 'artifacts' && <ArtifactsPage />}
              </Suspense>
            </div>
          )}
        </main>
        <AnimatePresence initial={false}>
          {showRight && rightPanelTab && (
            <RightPanel
              key="right-panel"
              sessionId={activeTab?.kind === 'chat' ? activeTab.sessionId : undefined}
              activeTab={rightPanelTab}
            />
          )}
        </AnimatePresence>
      </div>
      <ToastContainer />
      <SettingsDialog />
      <GlobalCommandPalette />
    </div>
  );
}
