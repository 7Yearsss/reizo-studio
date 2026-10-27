import { app, ipcMain } from 'electron';
import { IPC } from '../shared/constants';
import { DEEP_LINK_PROTOCOL, deepLinkFromArgv, parseDeepLink, type DeepLinkAction } from '../shared/deepLink';
import { createMainWindow, getMainWindow } from './window';

/** Links wait here until the renderer has asked for them; nothing acts on a link without the user's confirmation card. */
const pending: DeepLinkAction[] = [];
let rendererReady = false;

function deliver(action: DeepLinkAction): void {
  const win = getMainWindow();
  if (!rendererReady || !win || win.isDestroyed()) { pending.push(action); return; }
  win.webContents.send(IPC.DEEP_LINK, action);
  if (win.isMinimized()) win.restore();
  win.focus();
}

export function handleDeepLinkUrl(raw: string | null): void {
  if (!raw) return;
  const action = parseDeepLink(raw);
  if (!action) return;
  deliver(action);
}

export function registerDeepLinks(): void {
  // In dev the executable is electron itself, so the script path has to be passed along.
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [process.argv[1]]);
  else app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  app.on('open-url', (event, url) => { event.preventDefault(); handleDeepLinkUrl(url); });
  ipcMain.handle(IPC.DEEP_LINK_TAKE, (): DeepLinkAction[] => {
    rendererReady = true;
    return pending.splice(0);
  });
  // A link that launched the app (Windows / Linux pass it as an argument).
  handleDeepLinkUrl(deepLinkFromArgv(process.argv));
}

export function deepLinkFromSecondInstance(argv: readonly string[]): void {
  handleDeepLinkUrl(deepLinkFromArgv(argv));
  createMainWindow();
}
