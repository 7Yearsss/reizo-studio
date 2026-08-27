import { useState } from 'react';
import CustomTitleBar from './CustomTitleBar';
import Sidebar from './Sidebar';
import RightPanel from '../workspace/RightPanel';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useTabStore } from '../../state/useTabStore';
import { useUiStore } from '../../state/useUiStore';
import HomePage from '../../pages/HomePage';
import ChatPage from '../../pages/ChatPage';
import SettingsPage from '../../pages/SettingsPage';
import AutomationPage from '../../pages/AutomationPage';
import PluginsPage from '../../pages/PluginsPage';

/**
 * Mounts every open workspace tab at once and hides inactive ones with an
 * inline `display: none` (same keep-alive trick as winlume WorkspaceTabsHost).
 * Switching tabs therefore never remounts ChatPage — composer drafts, scroll
 * position, and in-flight streams all survive.
 */
export default function MainLayout() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const artifactsOpen = useUiStore((s) => s.artifactsOpen);
  const [treeOpen, setTreeOpen] = useState(true);
  const isWorkbench = activeTab?.kind === 'chat' || activeTab?.kind === 'launcher';
  const showWorkspace = Boolean(workspacePath) && isWorkbench && treeOpen;
  const showArtifacts = activeTab?.kind === 'chat' && artifactsOpen;
  const showRight = showWorkspace || showArtifacts;

  return (
    <div className="flex h-screen flex-col bg-paper text-ink">
      <CustomTitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className="flex min-h-0 flex-1 flex-col"
                style={active ? undefined : { display: 'none' }}
              >
                {tab.kind === 'launcher' && <HomePage />}
                {tab.kind === 'chat' && tab.sessionId && (
                  <ChatPage
                    sessionId={tab.sessionId}
                    active={active}
                    onToggleTree={() => setTreeOpen((o) => !o)}
                    treeOpen={showWorkspace}
                  />
                )}
                {tab.kind === 'settings' && <SettingsPage />}
                {tab.kind === 'automation' && <AutomationPage />}
                {tab.kind === 'plugins' && <PluginsPage />}
              </div>
            );
          })}
        </main>
        {showRight && (
          <RightPanel sessionId={activeTab?.kind === 'chat' ? activeTab.sessionId : undefined} showWorkspace={showWorkspace} />
        )}
      </div>
    </div>
  );
}
