import { expect, it, vi } from 'vitest';
import { AccountWalletClient } from './wallet';
import type { AccountPaymentOrder } from '../../shared/accountWallet';

const organizationId = '11111111-1111-4111-8111-111111111111';
const token = 't'.repeat(43); const reference = 'RZD1234567890123456789012345678901234567890';
const order: AccountPaymentOrder = { id: 'order', reference, status: 'pending', amount: 20, currency: 'CNY', credits: 20, provider: 'epay', paymentMethod: 'wxpay', createdAt: '2026-10-24T01:00:00Z', paidAt: null };
const snapshot = { organization: { id: organizationId, name: '测试工作区' }, balance: { availableCredits: 12, currency: 'CNY', syncStatus: 'ready' }, canTopup: true,
  config: { enabled: true, provider: 'epay', currency: 'CNY', creditsPerUnit: 1, minTopup: 1, maxTopup: 1000, amountOptions: [5, 20], methods: [{ type: 'wxpay', name: '微信支付' }] }, orders: [order], order };
const input = { organizationId, amount: 20, paymentMethod: 'wxpay', requestId: '22222222-2222-4222-8222-222222222222' };
const cashier = `https://reizo.example/api/desktop-auth/cashier?ticket=payload.${'s'.repeat(43)}`;
const purchase = { url: 'https://pay.example/epay/submit.php', params: { pid: 'merchant', type: 'wxpay', out_trade_no: reference,
  notify_url: 'https://reizo.example/api/pay/epay/notify', return_url: `https://reizo.example/account/wallet?order=${reference}`,
  name: 'Reizo 充值 20 积分', money: '20.00', device: 'pc', sign_type: 'MD5', sign: 'a'.repeat(32) } };
function fixture() {
  let identity = { token, userId: 'user', generation: 1 };
  const fetcher = vi.fn<typeof fetch>(); const open = vi.fn(async () => undefined);
  fetcher.mockImplementation(async url => String(url).includes('/cashier?') ? Response.json(purchase) : Response.json({ order, cashierUrl: cashier }));
  const client = new AccountWalletClient({ origin: 'https://reizo.example', fetch: fetcher, openCashier: open, identity: () => identity });
  return { client, fetcher, open, logout: () => { identity = null; } };
}

it('uses desktop authorization and returns public wallet fields without credentials or cashier tickets', async () => {
  const f = fixture(); f.fetcher.mockResolvedValue(Response.json({ ...snapshot, cashierUrl: cashier, apiKey: 'sk-private' }));
  const wallet = await f.client.read();
  expect(wallet.organization.id).toBe(organizationId);
  expect(JSON.stringify(wallet)).not.toMatch(/sk-private|cashier|Bearer/);
  expect(f.fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` } });
});

it('deduplicates concurrent creation, keeps the same request identity, and only opens the trusted cashier', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([f.client.create(input), f.client.create(input)]);
  expect(f.fetcher).toHaveBeenCalledTimes(2); expect(f.open).toHaveBeenCalledOnce();
  expect(f.open).toHaveBeenCalledWith({ ...purchase, reference, amount: 20, currency: 'CNY' });
  expect(f.fetcher.mock.calls[1][1].headers).toEqual({ Accept: 'application/json' });
  expect(first).toEqual(second); expect(first).toMatchObject({ order, cashierOpened: true });
  expect(JSON.stringify(first)).not.toContain('ticket'); expect(cashier).not.toContain(token);
  expect(JSON.parse(f.fetcher.mock.calls[0][1].body as string)).toEqual(input);
});

it.each([cashier.replace('reizo.example', 'evil.example'), `${cashier}&redirect=evil`, `${cashier}#fragment`])('rejects an untrusted checkout URL before opening a browser', async url => {
  const f = fixture(); f.fetcher.mockResolvedValue(Response.json({ order, cashierUrl: url }));
  await expect(f.client.create(input)).rejects.toThrow('收银台地址无效'); expect(f.open).not.toHaveBeenCalled();
});

it('does not open a late cashier response after logout', async () => {
  const f = fixture(); let resolve!: (response: Response) => void;
  f.fetcher.mockReturnValue(new Promise(yes => { resolve = yes; }));
  const pending = f.client.create(input); f.logout(); resolve(Response.json({ order, cashierUrl: cashier }));
  await expect(pending).rejects.toThrow('账号状态已变化'); expect(f.open).not.toHaveBeenCalled();
});

it('reopens an existing order by GET and never turns a paid order into another checkout', async () => {
  const f = fixture(); f.fetcher.mockResolvedValue(Response.json({ ...snapshot, order: { ...order, status: 'success' } }));
  expect(await f.client.open({ organizationId, order: reference })).toMatchObject({ order: { status: 'success' }, cashierOpened: false });
  expect(f.fetcher.mock.calls[0][1].method).toBe('GET'); expect(f.open).not.toHaveBeenCalled();
});

it('retains a created order on browser-open failure and rejects mismatched payment details', async () => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json({ order, cashierUrl: cashier })); f.open.mockRejectedValueOnce(new Error('browser unavailable'));
  expect(await f.client.create(input)).toMatchObject({ order: { reference }, cashierOpened: false });
  f.fetcher.mockResolvedValueOnce(Response.json({ order: { ...order, amount: 200 }, cashierUrl: cashier }));
  await expect(f.client.create(input)).rejects.toThrow('订单金额或支付方式'); expect(f.open).toHaveBeenCalledTimes(1);
});

it('reports an unpublished web API and does not automatically retry an uncertain order submission', async () => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 }));
  await expect(f.client.read()).rejects.toThrow('尚未启用客户端充值');
  f.fetcher.mockRejectedValueOnce(new TypeError('network disconnected'));
  await expect(f.client.create(input)).rejects.toThrow();
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it('rejects an old HTML bridge or a cashier purchase for a different order', async () => {
  const f = fixture();
  f.fetcher.mockResolvedValueOnce(Response.json({ order, cashierUrl: cashier })).mockResolvedValueOnce(new Response('<form>broken bridge</form>', { headers: { 'Content-Type': 'text/html' } }));
  await expect(f.client.create(input)).rejects.toThrow('内置收银台');
  f.fetcher.mockResolvedValueOnce(Response.json({ order, cashierUrl: cashier })).mockResolvedValueOnce(Response.json({ ...purchase, params: { ...purchase.params, money: '200.00' } }));
  await expect(f.client.create(input)).rejects.toThrow('原订单信息不符');
  expect(f.open).not.toHaveBeenCalled();
});

it('does not open the native cashier when logout races its purchase parameter request', async () => {
  const f = fixture(); let resolve!: (response: Response) => void;
  f.fetcher.mockResolvedValueOnce(Response.json({ order, cashierUrl: cashier })).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const pending = f.client.create(input);
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  f.logout(); resolve(Response.json(purchase));
  await expect(pending).rejects.toThrow('账号状态已变化'); expect(f.open).not.toHaveBeenCalled();
});
