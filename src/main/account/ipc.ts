import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC } from '../../shared/constants';
import { createMainWindow } from '../window';
import { AccountService, accountOrigin } from './service';
import { createAccountStorage } from './storage';
import { closeAccountCashier, openAccountCashier } from './cashierWindow';

export function createDesktopAccountService(dataRoot: string) {
  const origin = accountOrigin(process.env.REIZO_ACCOUNT_ORIGIN || 'https://reizo-ai.com', !app.isPackaged);
  const storage = createAccountStorage(dataRoot, safeStorage);
  return new AccountService({ origin, fetch, ...storage, modelSessions: true, open: (url) => shell.openExternal(url), openCashier: openAccountCashier, connected: () => { createMainWindow(); } });
}

export function registerAccountIpc(dataRoot: string, service = createDesktopAccountService(dataRoot)) {
  let stopped = false;
  const rendererUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).href;
  const channels = [IPC.ACCOUNT_STATUS, IPC.ACCOUNT_LOGIN, IPC.ACCOUNT_LOGOUT, IPC.ACCOUNT_REOPEN, IPC.ACCOUNT_REFRESH, IPC.ACCOUNT_WALLET, IPC.ACCOUNT_TOPUP, IPC.ACCOUNT_TOPUP_OPEN] as const;
  for (const channel of channels) {
    ipcMain.handle(channel, async (event, input?: unknown) => {
      const frame = event.senderFrame;
      const expected = new URL(rendererUrl);
      const actual = frame ? new URL(frame.url) : null;
      if (!frame || frame !== event.sender.mainFrame || !BrowserWindow.fromWebContents(event.sender) || !actual || actual.origin !== expected.origin || actual.pathname !== expected.pathname) throw new Error('Untrusted account request');
      if (channel === IPC.ACCOUNT_LOGIN) { closeAccountCashier(); return service.start(); }
      if (channel === IPC.ACCOUNT_LOGOUT) { closeAccountCashier(); return service.logout(); }
      if (channel === IPC.ACCOUNT_REOPEN) { await service.reopen(); return service.snapshot(); }
      if (channel === IPC.ACCOUNT_REFRESH) return service.refresh();
      if (channel === IPC.ACCOUNT_WALLET) return service.wallet.read(input ?? {});
      if (channel === IPC.ACCOUNT_TOPUP) return service.wallet.create(input);
      if (channel === IPC.ACCOUNT_TOPUP_OPEN) return service.wallet.open(input);
      return service.snapshot();
    });
  }
  let lastRefresh = 0;
  const tick = () => {
    const pending = service.snapshot().status === 'pending';
    if (!pending && Date.now() - lastRefresh < 60_000) return;
    lastRefresh = Date.now();
    if (!stopped) void service.refresh().then(state => { if (state.status === 'signed-out') closeAccountCashier(); }).catch((): void => undefined);
  };
  tick();
  const timer = setInterval(tick, 4000);
  timer.unref();
  return () => { stopped = true; closeAccountCashier(); service.dispose(); clearInterval(timer); for (const channel of channels) ipcMain.removeHandler(channel); };
}
