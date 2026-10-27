import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { IPC } from '../shared/constants';
import { shouldNudge } from '../shared/attention';
import { getAppIcon, getMainWindow } from './window';
import { setTrayTooltip } from './tray';

let previousIds: string[] = [];

interface Payload { ids: string[]; title: string; tooltip: string }

function parse(value: unknown): Payload | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.ids) || !v.ids.every((id) => typeof id === 'string') || typeof v.tooltip !== 'string' || typeof v.title !== 'string') return null;
  return { ids: (v.ids as string[]).slice(0, 50), title: v.title.slice(0, 80), tooltip: v.tooltip.slice(0, 120) };
}

/** The renderer reports which conversations wait for the user; the shell shows it where a background window can be seen. */
export function registerAttention(): void {
  ipcMain.on(IPC.ATTENTION, (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== getMainWindow()) return;
    const payload = parse(raw);
    if (!payload) return;
    const count = payload.ids.length;
    setTrayTooltip(payload.tooltip);
    try { app.setBadgeCount(count); } catch { /* not supported everywhere */ }
    const focused = win.isFocused() && win.isVisible() && !win.isMinimized();
    if (count === 0 || focused) win.flashFrame(false);
    if (shouldNudge(previousIds, payload.ids, focused)) {
      win.flashFrame(true);
      try {
        const n = new Notification({ title: 'Reizo 在等你', body: count === 1 ? `「${payload.title || '对话'}」需要你确认` : `${count} 个对话需要你确认`, icon: getAppIcon() });
        n.on('click', () => { win.show(); win.focus(); });
        n.show();
      } catch { /* ignore */ }
    }
    previousIds = payload.ids;
  });
}
