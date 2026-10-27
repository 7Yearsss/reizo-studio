import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, powerMonitor, powerSaveBlocker } from 'electron';
import { describeActiveWork, hasActiveWork } from '../shared/quitConfirm';
import { liveTurnCount } from './server/agent/session';
import { stopAllBackgroundShells } from './backgroundShells';
import { registerQuickAssistantIpc, toggleQuickAssistant } from './quickAssistant';
import { deepLinkFromSecondInstance, registerDeepLinks } from './deepLinks';
import { screenshotToChat } from './screenshotToChat';
import { registerAttention } from './attention';
import { activeVideoJobCount } from './server/canvas/videoJobRuntime';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { IPC } from '../shared/constants';
import { startLocalServer, stopLocalServer, type RunningServer } from './server/listen';
import { openDb, type DbHandle } from './server/db/client';
import { importLegacySessions } from './server/db/importLegacySessions';
import { createSqliteSessionStore } from './server/storage/sqliteSessionStore';
import { createSettingsStore } from './server/storage/settingsStore';
import { createScheduleStore } from './server/storage/scheduleStore';
import { createUsageStore } from './server/storage/usageStore';
import { createThoughtStore } from './server/storage/thoughtStore';
import { createMainWindow, getAppIcon, setQuitting } from './window';
import { stopAllComputerControl } from './computerUse';
import { applyPendingRestore } from './server/backup/backup';
import { startAutoBackup } from './autoBackup';
import { initComputerStopOverlay } from './computerUse/stopOverlay';
import { registerWindowIpc } from './windowIpc';
import { registerWorkspaceIpc } from './workspaceIpc';
import { createTray } from './tray';
import { startScheduler } from './schedulerHost';
import { drainMemoryJobs } from './memoryJobs';
import { registerSkillIpc } from './skillsIpc';
import { registerPluginIpc } from './pluginsIpc';
import { createDesktopAccountService, registerAccountIpc } from './account/ipc';

if (started) {
  app.quit();
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.reizo.studio');
}

// Containerized/headless dev sandboxes often can't launch Chromium's GPU/
// zygote sandbox at all. Opt-in only (never set in a real user's packaged
// build) via REIZO_DEV_NO_SANDBOX=1, purely so `npm start` is testable here.
if (process.env.REIZO_DEV_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox');
  // Some sandboxes can't host Chromium POSIX shm files at all — write them to
  // a real temp dir instead of /dev/shm.
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('no-zygote');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
  app.disableHardwareAcceleration();
} else {
  // Electron's Chromium builds still gate WebGPU behind this switch on some GPUs.
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
}

let runningServer: RunningServer | null = null;
let dbHandle: DbHandle | null = null;
let freezeTurnMarkers: (() => void) | null = null;
let stopAutoBackup: (() => void) | null = null;
let stopScheduler: (() => Promise<void>) | null = null;
let tickScheduler: (() => void) | null = null;
let shuttingDown = false;
let stopAccount: (() => void) | null = null;
// Recovery assumes exclusive ownership of this data directory.
const primaryInstance = !started && app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', (_event, argv) => {
  if (runningServer) deepLinkFromSecondInstance(argv);
});

function devServerOrigin(): string | undefined {
  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) return undefined;
  return new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
}

async function bootstrap(): Promise<void> {
  if (app.isPackaged) process.env.REIZO_VOICE_RUNTIME = path.join(process.resourcesPath, 'voice-runtime');
  if (app.isPackaged) process.env.REIZO_VIDEO_EDITOR_RUNTIME = path.join(process.resourcesPath, 'video-editor', 'runtime.json');
  const dataRoot = path.join(app.getPath('userData'), 'data');
  mkdirSync(dataRoot, { recursive: true });
  // A restore queued by the user is applied here, before any store or the database touches the data folder. One interrupted by a crash is rolled back.
  const restore = await applyPendingRestore(dataRoot);
  if (restore.status !== 'none') console.log('[main] restore:', restore.status, 'error' in restore ? restore.error : '');
  const account = createDesktopAccountService(dataRoot);
  const settingsStore = createSettingsStore(dataRoot, () => account.modelCredential());
  const scheduleStore = createScheduleStore(dataRoot);
  const thoughtStore = createThoughtStore(dataRoot);
  const skillsDirs = [path.join(process.cwd(), 'skills'), path.join(app.getAppPath(), 'skills'),
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'skills')] : []), path.join(dataRoot, 'skills')];

  dbHandle = openDb(path.join(dataRoot, 'reizo.db'));
  const importedCount = importLegacySessions(dataRoot, dbHandle.raw);
  if (importedCount > 0) console.log(`[main] imported ${importedCount} legacy session(s) into SQLite`);
  const sessionStore = createSqliteSessionStore(dbHandle);
  freezeTurnMarkers = () => sessionStore.freezeTurnMarkers();

  runningServer = await startLocalServer({
    dataRoot,
    settingsStore,
    sessionStore,
    scheduleStore,
    thoughtStore,
    skillsDirs,
    db: dbHandle,
    devServerOrigin: devServerOrigin(),
  });
  stopAutoBackup = startAutoBackup(dataRoot, () => dbHandle);
  ipcMain.handle(IPC.APP_RELAUNCH, () => { app.relaunch(); app.quit(); });
  const scheduler = startScheduler({ dataRoot, scheduleStore, settingsStore, skillsDirs, sessionStore, usageStore: createUsageStore(dbHandle) });
  stopScheduler = scheduler;
  tickScheduler = scheduler.tickNow;
  // Keep the machine awake while a reply or video is being produced, and look for missed schedules as soon as it wakes.
  let sleepBlock: number | null = null;
  setInterval(() => {
    const busy = hasActiveWork({ turns: liveTurnCount(), videoJobs: activeVideoJobCount() });
    if (busy && sleepBlock === null) sleepBlock = powerSaveBlocker.start('prevent-app-suspension');
    else if (!busy && sleepBlock !== null) { powerSaveBlocker.stop(sleepBlock); sleepBlock = null; }
  }, 15_000).unref();
  powerMonitor.on('resume', () => tickScheduler?.());

  ipcMain.handle(IPC.GET_API_ORIGIN, () => runningServer?.origin);
  ipcMain.handle(IPC.EXPORT_PDF, async (_e, html: string) => {
    const { exportHtmlToPdf } = await import('./pdfExport');
    const bytes = await exportHtmlToPdf(String(html ?? ''));
    return bytes.toString('base64');
  });
  registerWindowIpc();
  registerWorkspaceIpc(settingsStore);
  registerSkillIpc(path.join(dataRoot, 'skills'));
  registerPluginIpc(dataRoot, skillsDirs);
  stopAccount = registerAccountIpc(dataRoot, account);

  createMainWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    createMainWindow();
  });
  // A small floating box for a quick question from any app.
  registerQuickAssistantIpc();
  registerDeepLinks();
  globalShortcut.register('CommandOrControl+Alt+Space', () => { toggleQuickAssistant(); });
  // Screenshot the display under the cursor straight into the current conversation.
  globalShortcut.register('CommandOrControl+Alt+A', () => { void screenshotToChat(); });
  initComputerStopOverlay();
  // Emergency stop for computer control: works from any app, because the agent may be driving the screen.
  globalShortcut.register('CommandOrControl+Alt+Shift+S', () => {
    if (stopAllComputerControl() > 0) {
      try { new Notification({ title: 'Reizo', body: '已停止电脑操作', icon: getAppIcon() }).show(); } catch { /* ignore */ }
    }
  });
}

/** Hard ceiling for the whole quit sequence; after it the process exits regardless of what is still stopping. */
const SHUTDOWN_DEADLINE_MS = 15_000;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAccount?.();
  stopAllBackgroundShells();
  // Synchronously, before any awaits: stop the server's shutdown path from
  // stamping a normal `last_turn_ended_at` over a turn that was really
  // interrupted by this quit.
  freezeTurnMarkers?.();
  freezeTurnMarkers = null;
  runningServer?.stopCanvasJobs();
  await stopScheduler?.().catch((error) => console.warn('[main] schedule interruption could not be persisted; records were retained', error));
  stopScheduler = null;
  stopAutoBackup?.();
  stopAutoBackup = null;
  globalShortcut.unregisterAll();
  await Promise.race([
    drainMemoryJobs(),
    new Promise((r: (v: void) => void) => setTimeout(r, 8000)),
  ]).catch((): void => undefined);
  if (runningServer) {
    await stopLocalServer(runningServer);
    runningServer = null;
  }
  if (dbHandle) {
    dbHandle.close();
    dbHandle = null;
  }
}

app.on('ready', () => {
  if (!primaryInstance) return;
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
  if (!primaryInstance) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    createMainWindow();
  }
});

let quitConfirmed = false;
let quitDialogOpen = false;

app.on('before-quit', (event) => {
  if (shuttingDown) { setQuitting(true); return; }
  // Quitting mid-reply or mid-video throws that work away: ask first. The dialog is async, so hold the quit and
  // re-issue it from a fresh task once the user decides (re-entering before-quit would leave a windowless process on macOS).
  const work = { turns: liveTurnCount(), videoJobs: activeVideoJobCount() };
  if (!quitConfirmed && hasActiveWork(work)) {
    event.preventDefault();
    if (quitDialogOpen) return;
    quitDialogOpen = true;
    const parent = BrowserWindow.getAllWindows()[0];
    const options = {
      type: 'warning' as const,
      buttons: ['继续运行', '中断并退出'],
      defaultId: 0,
      cancelId: 0,
      message: '还有任务在进行',
      detail: `${describeActiveWork(work).join('，')}。现在退出会中断它们。`,
    };
    void (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)).then(({ response }) => {
      quitDialogOpen = false;
      if (response === 1) { quitConfirmed = true; setTimeout(() => app.quit(), 0); }
    });
    return;
  }
  setQuitting(true);
  event.preventDefault();
  // A hung scheduler/server stop must not leave an invisible zombie process.
  const forceExit = setTimeout(() => {
    console.error('[main] shutdown exceeded its deadline; forcing exit');
    app.exit(0);
  }, SHUTDOWN_DEADLINE_MS);
  forceExit.unref();
  shutdown()
    .catch((err) => console.error('[main] shutdown error', err))
    .finally(() => { clearTimeout(forceExit); app.quit(); });
});
