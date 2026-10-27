import { useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import * as settingsStore from './state/settingsStore';
import * as chatStore from './state/chatStore';
import * as skillStore from './state/skillStore';
import * as projectStore from './state/projectStore';
import * as tabStore from './state/tabStore';
import * as uiStore from './state/uiStore';
import { dispatchChatDrop } from './lib/chatDrop';
import { toast } from './lib/toast';
import { summarizeAttention } from '../shared/attention';

export default function App() {
  // A question typed into the floating box opens its own conversation here.
  useEffect(() => {
    const off = window.reizo?.onQuickAsk?.((text) => {
      void (async () => {
        const session = await chatStore.createSession('新对话');
        uiStore.setMode('chat');
        tabStore.openChatTab(session.id, session.title);
        await chatStore.sendMessage(session.id, text);
      })();
    });
    return (): void => { off?.(); };
  }, []);

  useEffect(() => {
    void settingsStore.loadSettings();
    void chatStore.loadSessions();
    void skillStore.loadSkills();
    void projectStore.loadProjects();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  return <MainLayout />;
}
