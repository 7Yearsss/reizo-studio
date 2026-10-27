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

  // Which conversations wait for the user: shown on the tray, badge and taskbar when the window is in the background.
  useEffect(() => {
    let last = '';
    const report = (): void => {
      const state = chatStore.getSnapshot();
      const summary = summarizeAttention(state.sessions.map((s) => ({ id: s.id, title: s.title, waiting: Boolean(state.interactionBySession[s.id]) })));
      const key = JSON.stringify([summary.ids, summary.tooltip]);
      if (key === last) return;
      last = key;
      window.reizo?.reportAttention?.({ ids: summary.ids, title: summary.title, tooltip: summary.tooltip });
    };
    report();
    return chatStore.subscribe(report);
  }, []);

  // The screenshot shortcut: attach the picture to the open conversation, or start one.
  useEffect(() => {
    const off = window.reizo?.onScreenshot?.((payload) => {
      void (async () => {
        if (!payload.dataUrl) { toast.error(payload.error ?? '截屏失败'); return; }
        const blob = await (await fetch(payload.dataUrl)).blob();
        const file = new File([blob], `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, { type: 'image/png' });
        let sessionId = tabStore.activeSessionId();
        const fresh = !sessionId;
        if (!sessionId) {
          const session = await chatStore.createSession('截图');
          tabStore.openChatTab(session.id, session.title);
          sessionId = session.id;
        }
        uiStore.setMode('chat');
        // A new tab's composer needs a moment to mount before it can receive the file.
        const target = sessionId;
        window.setTimeout(() => dispatchChatDrop(target, [file]), fresh ? 400 : 0);
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
