import CustomTitleBar from './CustomTitleBar';
import Sidebar from './Sidebar';
import RightPanel from '../workspace/RightPanel';
import { useTabStore } from '../../state/useTabStore';
import { useUiStore } from '../../state/useUiStore';
import * as uiStore from '../../state/uiStore';
import HomePage from '../../pages/HomePage';
import ChatPage from '../../pages/ChatPage';
import SettingsPage from '../../pages/SettingsPage';
import AutomationPage from '../../pages/AutomationPage';
import PluginsPage from '../../pages/PluginsPage';
import ArtifactsPage from '../../pages/ArtifactsPage';
import ToastContainer from '../ui/ToastContainer';
import GlobalCommandPalette from './GlobalCommandPalette';

/**
 * The full app shell: title bar, sidebar, and tab-switched main stage.
 */
export default function MainLayout() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const mode = useUiStore((s) => s.mode);
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const isChatView = mode === 'chat' || mode === 'projects';
  const showRight = isChatView && rightPanelTab !== null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      <CustomTitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className={isChatView ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className="flex min-h-0 flex-1 flex-col"
                  style={active ? undefined : { display: 'none' }}
                >
                  {tab.kind === 'launcher' && <HomePage active={active} />}
                  {tab.kind === 'chat' && tab.sessionId && (
                    <ChatPage
                      sessionId={tab.sessionId}
                      active={active}
                      onToggleTree={() => uiStore.toggleRightPanelTab('files')}
                      treeOpen={rightPanelTab === 'files'}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {!isChatView && (
            <div className="min-h-0 min-w-0 flex-1">
              {mode === 'settings' && <SettingsPage />}
              {mode === 'automation' && <AutomationPage />}
              {mode === 'skills' && <PluginsPage />}
              {mode === 'artifacts' && <ArtifactsPage />}
            </div>
          )}
        </main>
        {showRight && rightPanelTab && (
          <RightPanel
            sessionId={activeTab?.kind === 'chat' ? activeTab.sessionId : undefined}
            activeTab={rightPanelTab}
          />
        )}
      </div>
      <ToastContainer />
      <GlobalCommandPalette />
    </div>
  );
}
