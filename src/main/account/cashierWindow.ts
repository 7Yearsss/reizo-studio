import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { getAppIcon, getMainWindow } from '../window';
import { isCashierUrl, type CashierPurchase } from './cashierPolicy';

let current: BrowserWindow | null = null;

export function closeAccountCashier(): void {
  if (current && !current.isDestroyed()) current.destroy();
  current = null;
}

export async function openAccountCashier(purchase: CashierPurchase): Promise<void> {
  if (!isCashierUrl(purchase.url)) throw new Error('收银台地址无效。');
  closeAccountCashier();
  const isolated = session.fromPartition(`reizo-cashier-${randomUUID()}`);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', event => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url.replace(/^wss:/, 'https:');
    callback({ cancel: !/^(data|blob):/.test(url) && !isCashierUrl(url) });
  });
  const title = `Reizo 充值收银台 · ${purchase.currency} ${purchase.amount.toFixed(2)}`;
  const win = new BrowserWindow({
    title, width: 720, height: 820, minWidth: 480, minHeight: 600,
    parent: getMainWindow() ?? undefined, icon: getAppIcon(), autoHideMenuBar: true, backgroundColor: '#ffffff',
    webPreferences: { session: isolated, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false },
  });
  current = win;
  win.setMenu(null);
  win.webContents.on('page-title-updated', event => { event.preventDefault(); win.setTitle(title); });
  const guard = (event: Electron.Event, url: string) => { if (!isCashierUrl(url)) event.preventDefault(); };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isCashierUrl(url)) void win.loadURL(url).catch((): void => undefined);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    if (current === win) current = null;
    void isolated.clearStorageData().catch((): void => undefined);
    getMainWindow()?.focus();
  });
  try {
    await win.loadURL(purchase.url, {
      postData: [{ type: 'rawData', bytes: Buffer.from(new URLSearchParams(purchase.params).toString(), 'utf8') }],
      extraHeaders: 'Content-Type: application/x-www-form-urlencoded\r\n',
    });
  } catch {
    if (!win.isDestroyed()) win.destroy();
    throw new Error('暂时无法打开收银台，请在原订单中继续付款。');
  }
}
