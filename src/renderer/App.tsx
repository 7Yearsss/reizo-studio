import { useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import MainLayout from './components/layout/MainLayout';
import ScreenshotCropDialog, { SCREENSHOT_CAPTURED_EVENT } from './components/layout/ScreenshotCropDialog';
import * as settingsStore from './state/settingsStore';
import * as chatStore from './state/chatStore';
import * as skillStore from './state/skillStore';
import * as projectStore from './state/projectStore';
import * as tabStore from './state/tabStore';
import * as uiStore from './state/uiStore';
import { dispatchChatDrop } from './lib/chatDrop';
import { toast, showToast } from './lib/toast';
import { backgroundFinished } from '../shared/backgroundFinish';
import { summarizeAttention } from '../shared/attention';
import { ConfirmDialog } from '@/renderer/components/ui/ConfirmDialog';

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

  // A reply that finishes in a conversation the user is not looking at: say so, with a way back to it.
  useEffect(() => {
    let previous = { ...chatStore.getSnapshot().sendingBySession };
    return chatStore.subscribe(() => {
      const state = chatStore.getSnapshot();
      const next = state.sendingBySession;
      if (next === previous) return;
      const visible = uiStore.getSnapshot().mode === 'chat' ? tabStore.activeSessionId() : undefined;
      const interrupted = new Set(Object.entries(state.turnOutcomeBySession).filter(([, outcome]) => outcome === 'interrupted').map(([id]) => id));
      for (const id of backgroundFinished({ previous, next, visibleSessionId: visible, interrupted })) {
        const title = state.sessions.find((s) => s.id === id)?.title ?? '对话';
        const failed = state.turnOutcomeBySession[id] === 'error';
        showToast({
          title: failed ? `「${title}」出错了` : `「${title}」已完成`,
          status: failed ? 'error' : 'success',
          duration: 8000,
          action: { label: '查看', onClick: () => { uiStore.setMode('chat'); tabStore.openChatTab(id, title); } },
        });
      }
      previous = { ...next };
    });
  }, []);

  // The screenshot shortcut: show the picture for cropping first (ScreenshotCropDialog below).
  useEffect(() => {
    const off = window.reizo?.onScreenshot?.((payload) => {
      if (!payload.dataUrl) { toast.error(payload.error ?? '截屏失败'); return; }
      window.dispatchEvent(new CustomEvent(SCREENSHOT_CAPTURED_EVENT, { detail: { dataUrl: payload.dataUrl } }));
    });
    return (): void => { off?.(); };
  }, []);

  /** The cropped picture goes to the open conversation, or starts one. */
  async function attachScreenshot(file: File): Promise<void> {
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
  }

  useEffect(() => {
    void settingsStore.loadSettings();
    void chatStore.loadSessions();
    void skillStore.loadSkills();
    void projectStore.loadProjects();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  return (
    // One switch for every motion component: transforms and layout animation drop out under prefers-reduced-motion.
    <MotionConfig reducedMotion="user">
      <MainLayout />
      <ConfirmDialog />
      <ScreenshotCropDialog onDone={(file) => { void attachScreenshot(file); }} />
    </MotionConfig>
  );
}
