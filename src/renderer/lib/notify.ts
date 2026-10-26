/**
 * Fire an OS notification when a long canvas job finishes while the app is not
 * focused. No-ops when the window is visible, permission is denied, or the
 * environment has no Notification API. Bursts are collapsed.
 */
import logoUrl from '../assets/logo.png';

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
    const n = new Notification(title, { body, tag: 'reizo-canvas-job', icon: logoUrl });
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

/** A finished (or failed) long reply while the window is out of sight. */
export function notifyTurnDone(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') {
      primeNotifications();
      return;
    }
    const n = new Notification(title, { body, tag: 'reizo-turn-done', icon: logoUrl });
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

/**
 * Fire an OS notification when the agent suspends on a question/approval while
 * the app isn't focused — otherwise a pending card sits invisible until the
 * user happens to look back.
 */
export function notifyNeedsInput(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (typeof document !== 'undefined' && !document.hidden) return;
    if (Notification.permission !== 'granted') {
      primeNotifications();
      return;
    }
    const now = Date.now();
    if (now - lastAt < 1500) return;
    lastAt = now;
    const n = new Notification(title, { body, tag: 'reizo-needs-input', icon: logoUrl });
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
