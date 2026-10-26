import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/constants';
import { normalizeQuickAsk, QUICK_WINDOW_HASH, quickWindowPosition } from '../shared/quickAsk';
import { createMainWindow, getAppIcon } from './window';

const SIZE = { width: 620, height: 150 };
let win: BrowserWindow | null = null;

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    ...SIZE,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: false,
    icon: getAppIcon(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${QUICK_WINDOW_HASH}`);
  else void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { hash: QUICK_WINDOW_HASH });
  // Clicking anywhere else dismisses it; the typed text is not kept.
  win.on('blur', () => { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); });
  win.on('closed', () => { win = null; });
  return win;
}

/** Show the small floating box on the display the pointer is on, or hide it if it is already up. */
export function toggleQuickAssistant(): void {
  const window = ensureWindow();
  if (window.isVisible()) { window.hide(); return; }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y } = quickWindowPosition(display.workArea, SIZE);
  window.setPosition(x, y);
  window.webContents.send(IPC.QUICK_RESET);
  window.show();
  window.focus();
}

/** Hand a question to the main window, which opens a new conversation for it. */
function deliver(text: string): void {
  const main = createMainWindow();
  const send = (): void => { if (!main.isDestroyed()) main.webContents.send(IPC.QUICK_ASK, text); };
  if (main.webContents.isLoading()) main.webContents.once('did-finish-load', () => setTimeout(send, 400));
  else send();
}

export function registerQuickAssistantIpc(): void {
  ipcMain.handle(IPC.QUICK_SUBMIT, (_event, raw: unknown) => {
    const text = normalizeQuickAsk(raw);
    if (!text) return false;
    win?.hide();
    deliver(text);
    return true;
  });
  ipcMain.handle(IPC.QUICK_HIDE, () => { win?.hide(); });
}
