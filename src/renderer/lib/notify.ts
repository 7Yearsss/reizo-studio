/**
 * Fire an OS notification when a long canvas job finishes while the app is not
 * focused. No-ops when the window is visible, permission is denied, or the
 * environment has no Notification API. Bursts are collapsed.
 */
let lastAt = 0;

export function primeNotifications(): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

export function notifyJobDone(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (typeof document !== 'undefined' && !document.hidden) return; // only when unfocused
    if (Notification.permission !== 'granted') {
      primeNotifications();
      return;
    }
    const now = Date.now();
    if (now - lastAt < 1500) return;
    lastAt = now;
    const n = new Notification(title, { body, tag: 'reizo-canvas-job' });
    n.onclick = () => {
      try {
        window.focus();
        n.close();
      } catch {
        /* ignore */
      }
    };
  } catch {
    /* ignore */
  }
}
