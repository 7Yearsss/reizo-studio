import { app, Menu, nativeImage, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createMainWindow, getAppIcon } from './window';

let tray: Tray | null = null;

/**
 * Keep the app resident with the local server running in the background.
 * One click brings the window back; Quit from the menu exits. Wrapped
 * defensively — some Linux environments have no tray/status-area support,
 * and that should not take the app down.
 */
export function createTray(): Tray | null {
  if (tray) return tray;

  try {
    const iconPath = getAppIcon() || path.join(process.cwd(), 'resources', 'icon.png');
    const trayIcon = iconPath && fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
      : nativeImage.createEmpty();
    tray = new Tray(trayIcon);
    tray.setToolTip('Reizo Studio');

    const menu = Menu.buildFromTemplate([
      { label: 'Open', click: () => createMainWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => createMainWindow());

    return tray;
  } catch (err) {
    console.warn('[tray] unavailable in this environment, skipping', err);
    tray = null;
    return null;
  }
}
