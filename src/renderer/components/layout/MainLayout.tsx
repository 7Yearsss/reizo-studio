import { useState } from 'react';
import CustomTitleBar from './CustomTitleBar';
import Sidebar from './Sidebar';
import RightPanel from '../workspace/RightPanel';
import { useSettingsStore } from '../../state/useSettingsStore';
import { useTabStore } from '../../state/useTabStore';
import HomePage from '../../pages/HomePage';
import ChatPage from '../../pages/ChatPage';
import SettingsPage from '../../pages/SettingsPage';
import AutomationPage from '../../pages/AutomationPage';
import PluginsPage from '../../pages/PluginsPage';

export default function MainLayout() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const [treeOpen, setTreeOpen] = useState(true);
  const showTree =
    Boolean(workspacePath) &&
    (activeTab?.kind === 'chat' || activeTab?.kind === 'launcher') &&
    treeOpen;

  return (
    <div className="flex h-screen flex-col bg-paper text-ink">
      <CustomTitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {tabs.map((tab) => (
            <div key={tab.id} className={tab.id === activeTabId ? 'flex h-full min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
              {tab.kind === 'launcher' && <HomePage />}
              {tab.kind === 'chat' && tab.sessionId && (
                <ChatPage sessionId={tab.sessionId} onToggleTree={() => setTreeOpen((o) => !o)} treeOpen={showTree} />
              )}
              {tab.kind === 'settings' && <SettingsPage />}
              {tab.kind === 'automation' && <AutomationPage />}
              {tab.kind === 'plugins' && <PluginsPage />}
            </div>
          ))}
        </main>
        {showTree && <RightPanel />}
      </div>
    </div>
  );
}
