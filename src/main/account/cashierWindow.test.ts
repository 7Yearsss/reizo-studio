import { beforeEach, expect, it, vi } from 'vitest';
import { isCashierUrl } from './cashierPolicy';

const mocks = vi.hoisted(() => ({
  created: vi.fn(), load: vi.fn(), destroyed: vi.fn(), permission: vi.fn(), check: vi.fn(), request: vi.fn(), clear: vi.fn(async () => undefined),
  listeners: new Map<string, (...args: unknown[]) => void>(),
}));
vi.mock('electron', () => ({
  session: { fromPartition: () => ({
    setPermissionRequestHandler: mocks.permission, setPermissionCheckHandler: mocks.check,
    on: (name: string, listener: (...args: unknown[]) => void) => mocks.listeners.set(name, listener),
    webRequest: { onBeforeRequest: mocks.request }, clearStorageData: mocks.clear,
  }) },
  BrowserWindow: class {
    private dead = false;
    constructor(options: unknown) { mocks.created(options); }
    webContents = { on: (name: string, listener: (...args: unknown[]) => void) => mocks.listeners.set(name, listener), setWindowOpenHandler: vi.fn() };
    setMenu(): void { return undefined; }
    setTitle(): void { return undefined; }
    on(name: string, listener: (...args: unknown[]) => void) { mocks.listeners.set(name, listener); }
    loadURL(...args: unknown[]) { return mocks.load(...args); }
    isDestroyed() { return this.dead; }
    destroy() { this.dead = true; mocks.destroyed(); mocks.listeners.get('closed')?.(); }
  },
}));
vi.mock('../window', () => ({ getAppIcon: (): undefined => undefined, getMainWindow: (): undefined => undefined }));
import { closeAccountCashier, openAccountCashier } from './cashierWindow';

const purchase = { url: 'https://pay.example/submit.php', params: { out_trade_no: 'RZD12345678', money: '10.00', name: 'Reizo 充值 10 积分', sign: 'order-signature' },
  reference: 'RZD12345678', amount: 10, currency: 'CNY' };
beforeEach(() => { closeAccountCashier(); vi.clearAllMocks(); mocks.listeners.clear(); mocks.load.mockResolvedValue(undefined); });

it('posts the existing order directly in a sandboxed native window without the desktop preload', async () => {
  await openAccountCashier(purchase);
  const options = mocks.created.mock.calls[0][0];
  expect(options.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
  expect(options.webPreferences).not.toHaveProperty('preload');
  expect(options.title).toContain('CNY 10.00');
  const [url, load] = mocks.load.mock.calls[0];
  expect(url).toBe(purchase.url);
  expect(Object.fromEntries(new URLSearchParams(load.postData[0].bytes.toString('utf8')))).toEqual(purchase.params);
  expect(load.extraHeaders).not.toContain('Authorization');
  expect(mocks.check.mock.calls[0][0]()).toBe(false);
  const deny = vi.fn(); mocks.permission.mock.calls[0][0](null, 'media', deny); expect(deny).toHaveBeenCalledWith(false);
});

it('blocks local/file navigation and downloads while allowing HTTPS payment redirects', async () => {
  await openAccountCashier(purchase);
  const event = { preventDefault: vi.fn() };
  mocks.listeners.get('will-redirect')?.(event, 'https://pay.other.example/qrcode');
  expect(event.preventDefault).not.toHaveBeenCalled();
  mocks.listeners.get('will-navigate')?.(event, 'file:///C:/private.txt');
  expect(event.preventDefault).toHaveBeenCalledOnce();
  mocks.listeners.get('will-download')?.(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  const callback = vi.fn(); mocks.request.mock.calls[0][0]({ url: 'http://127.0.0.1:47100/api/settings' }, callback);
  expect(callback).toHaveBeenCalledWith({ cancel: true });
});

it('cleans up a failed window without pretending the order is paid', async () => {
  mocks.load.mockRejectedValueOnce(new Error('network failure'));
  await expect(openAccountCashier(purchase)).rejects.toThrow('原订单');
  expect(mocks.destroyed).toHaveBeenCalledOnce(); expect(mocks.clear).toHaveBeenCalledOnce();
});

it.each(['file:///C:/secret', 'http://pay.example/', 'https://127.0.0.1/', 'https://10.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://router.local/', 'https://a.internal/', 'https://u:p@pay.example/', 'https://pay.example:47100/'])('rejects unsafe cashier navigation: %s', url => {
  expect(isCashierUrl(url)).toBe(false);
});
