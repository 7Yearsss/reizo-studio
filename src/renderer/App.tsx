import { useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import * as settingsStore from './state/settingsStore';
import * as chatStore from './state/chatStore';
import * as skillStore from './state/skillStore';

export default function App() {
  useEffect(() => {
    void settingsStore.loadSettings();
    void chatStore.loadSessions();
    void skillStore.loadSkills();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  return <MainLayout />;
}
