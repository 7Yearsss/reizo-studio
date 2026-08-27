import { app, Menu, nativeImage, Tray } from 'electron';
import { createMainWindow } from './window';

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
    // Placeholder 16x16 transparent icon until a real app icon is added
    // under resources/. Swap for nativeImage.createFromPath once one exists.
    tray = new Tray(nativeImage.createEmpty());
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
