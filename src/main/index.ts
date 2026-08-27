import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { IPC } from '../shared/constants';
import { startLocalServer, stopLocalServer, type RunningServer } from './server/listen';
import { createSettingsStore } from './server/storage/settingsStore';
import { createScheduleStore } from './server/storage/scheduleStore';
import { createThoughtStore } from './server/storage/thoughtStore';
import { createMainWindow, setQuitting } from './window';
import { registerWindowIpc } from './windowIpc';
import { registerWorkspaceIpc } from './workspaceIpc';
import { createTray } from './tray';
import { startScheduler } from './schedulerHost';
import { registerSkillIpc } from './skillsIpc';

if (started) {
  app.quit();
}

// Containerized/headless dev sandboxes often can't launch Chromium's GPU/
// zygote sandbox at all. Opt-in only (never set in a real user's packaged
// build) via REIZO_DEV_NO_SANDBOX=1, purely so `npm start` is testable here.
if (process.env.REIZO_DEV_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
  app.disableHardwareAcceleration();
}

let runningServer: RunningServer | null = null;
let stopScheduler: (() => void) | null = null;
let shuttingDown = false;

function devServerOrigin(): string | undefined {
  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) return undefined;
  return new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
}

async function bootstrap(): Promise<void> {
  const dataRoot = path.join(app.getPath('userData'), 'data');
  const settingsStore = createSettingsStore(dataRoot);
  const scheduleStore = createScheduleStore(dataRoot);
  const thoughtStore = createThoughtStore(dataRoot);
  const skillsDirs = [path.join(process.cwd(), 'skills'), path.join(app.getAppPath(), 'skills'), path.join(dataRoot, 'skills')];

  runningServer = await startLocalServer({
    dataRoot,
    settingsStore,
    scheduleStore,
    thoughtStore,
    skillsDirs,
    devServerOrigin: devServerOrigin(),
  });
  stopScheduler = startScheduler({ dataRoot, scheduleStore, settingsStore, skillsDirs });

  ipcMain.handle(IPC.GET_API_ORIGIN, () => runningServer?.origin);
  registerWindowIpc();
  registerWorkspaceIpc(settingsStore);
  registerSkillIpc(path.join(dataRoot, 'skills'));

  createMainWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    createMainWindow();
  });
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  globalShortcut.unregisterAll();
  stopScheduler?.();
  stopScheduler = null;
  if (runningServer) {
    await stopLocalServer(runningServer);
    runningServer = null;
  }
}

app.on('ready', () => {
  bootstrap().catch((err) => {
    console.error('[main] failed to start', err);
    app.quit();
  });
});

app.on('window-all-closed', () => {
  // Keep running in the tray — closing the window hides it; only Quit from
  // the tray (or macOS Cmd+Q) actually kills the app.
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    createMainWindow();
  }
});

app.on('before-quit', (event) => {
  setQuitting(true);
  if (shuttingDown) return;
  event.preventDefault();
  shutdown()
    .catch((err) => console.error('[main] shutdown error', err))
    .finally(() => app.quit());
});
