import { app, BrowserWindow, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let quitting = false;

export function setQuitting(value: boolean): void {
  quitting = value;
}

export function isQuitting(): boolean {
  return quitting;
}

export function getAppIcon(): string | undefined {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidates = [
    path.join(process.cwd(), 'resources', iconName),
    path.join(app.getAppPath(), 'resources', iconName),
    path.resolve(__dirname, '../../resources', iconName),
    path.resolve(__dirname, '../resources', iconName),
    path.join(process.cwd(), 'resources', 'icon.png'),
    path.join(app.getAppPath(), 'resources', 'icon.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const isMac = process.platform === 'darwin';
  const iconPath = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: isMac,
    icon: iconPath,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 12 } : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#faf6ee',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (iconPath && process.platform === 'win32') {
    mainWindow.setIcon(iconPath);
  }

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[preload-error]', preloadPath, error);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[render-process-gone]', details);
  });

  // Allow F12 or Ctrl/Cmd+Shift+I to toggle DevTools in any environment
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown') {
      const isF12 = input.key === 'F12';
      const isDevToolsCombo = (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
      if (isF12 || isDevToolsCombo) {
        if (mainWindow?.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow?.webContents.openDevTools({ mode: 'detach' });
        }
      }
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Windows frameless windows can composite a solid background until DWM
  // gets a size change. Nudge by 1px on both initial show and every page reload.
  const triggerWindowsRepaintNudge = () => {
    if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
      const [width, height] = mainWindow.getSize();
      mainWindow.setSize(width, height + 1);
      mainWindow.setSize(width, height);
    }
  };

  mainWindow.webContents.on('did-finish-load', () => {
    triggerWindowsRepaintNudge();
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
    triggerWindowsRepaintNudge();
  });

  // Guarantee window visibility even if ready-to-show is delayed by hardware acceleration
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      triggerWindowsRepaintNudge();
    }
  }, 1000);

  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
