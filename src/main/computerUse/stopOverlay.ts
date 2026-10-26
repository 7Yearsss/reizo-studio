import { BrowserWindow, screen } from 'electron';
import { computerActivity } from './activity';
import { stopAllComputerControl } from './controller';

const STOP_URL = 'reizo-stop://now';

// A self-contained page: no preload, no node. Clicking navigates to STOP_URL, which the main process intercepts.
const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font:13px system-ui,"Microsoft YaHei",sans-serif}
a{display:flex;align-items:center;justify-content:center;gap:8px;height:40px;margin:2px;border-radius:20px;background:#c0392b;color:#fff;text-decoration:none;
box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;user-select:none;-webkit-app-region:no-drag}
a:hover{background:#a93226}b{width:12px;height:12px;background:#fff;border-radius:2px}
</style><a href="${STOP_URL}"><b></b>停止电脑操作</a>`;

let overlay: BrowserWindow | null = null;

function ensureOverlay(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay;
  const { workArea } = screen.getPrimaryDisplay();
  const width = 170;
  overlay = new BrowserWindow({
    width, height: 46, x: Math.round(workArea.x + workArea.width / 2 - width / 2), y: workArea.y + 8,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (url.startsWith('reizo-stop:')) stopAllComputerControl();
  });
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  overlay.on('closed', () => { overlay = null; });
  return overlay;
}

/** Show a stop button above everything while the agent is driving the machine; hide it when it is done. */
export function initComputerStopOverlay(): () => void {
  return computerActivity.subscribe((busy) => {
    if (busy) ensureOverlay().showInactive();
    else if (overlay && !overlay.isDestroyed()) overlay.hide();
  });
}
