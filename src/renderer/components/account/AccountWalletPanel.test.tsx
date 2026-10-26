// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ReizoBridge } from '../../../shared/window';
import type { AccountPaymentOrder, AccountWallet } from '../../../shared/accountWallet';
import AccountWalletPanel from './AccountWalletPanel';

const org = '11111111-1111-4111-8111-111111111111';
const order: AccountPaymentOrder = { id: 'one', reference: 'RZD1234567890123456789012345678901234567890', status: 'pending', amount: 20, currency: 'CNY', credits: 20,
  provider: 'epay', paymentMethod: 'wxpay', createdAt: '2026-10-24T01:00:00Z', paidAt: null };
const wallet: AccountWallet = { organization: { id: org, name: '团队工作区' }, balance: { availableCredits: 12, currency: 'CNY', syncStatus: 'ready' }, canTopup: true,
  config: { enabled: true, provider: 'epay', currency: 'CNY', creditsPerUnit: 1, minTopup: 1, maxTopup: 1000, amountOptions: [5, 20], methods: [{ type: 'alipay', name: '支付宝' }, { type: 'wxpay', name: '微信支付' }] }, orders: [] };
const mocks = { read: vi.fn(), create: vi.fn(), open: vi.fn() };
let root: Root; let host: HTMLDivElement; let previous: ReizoBridge;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  mocks.read.mockResolvedValue(wallet); mocks.create.mockResolvedValue({ order, cashierOpened: true });
  previous = window.reizo; window.reizo = { accountWallet: mocks.read, accountTopup: mocks.create, accountTopupOpen: mocks.open } as unknown as ReizoBridge;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.reizo = previous; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<AccountWalletPanel />)); }
async function button(text: string) {
  const element = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text);
  if (!element) throw new Error(`Missing button ${text}`);
  await act(async () => element.click());
}

it('uses live wallet choices and submits the reviewed workspace, amount and method only after a click', async () => {
  await render(); expect(host.textContent).toContain('团队工作区'); expect(mocks.create).not.toHaveBeenCalled();
  await button('¥20.00'); await button('微信支付');
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
  expect(mocks.create).toHaveBeenCalledWith({ organizationId: org, amount: 20, paymentMethod: 'wxpay', requestId: expect.any(String) });
  expect(host.textContent).toContain('已打开客户端收银台');
  expect(host.textContent).not.toContain('此订单已到账');
});

it('keeps pending distinct from credited and refreshes balance after the server confirms payment', async () => {
  mocks.read.mockResolvedValueOnce({ ...wallet, orders: [order] })
    .mockResolvedValueOnce({ ...wallet, orders: [{ ...order, status: 'crediting' }] })
    .mockResolvedValue({ ...wallet, balance: { ...wallet.balance, availableCredits: 32 }, orders: [{ ...order, status: 'success' }] });
  await render(); expect(host.textContent).toContain('待支付');
  await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(host.textContent).toContain('到账处理中');
  await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(host.textContent).toContain('已到账');
  expect(host.querySelector('.text-2xl')?.textContent).toBe('32');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('reuses the same request identity after an uncertain submission and never retries POST automatically', async () => {
  mocks.create.mockRejectedValueOnce(new Error('订单提交未确认')).mockResolvedValue({ order, cashierOpened: true });
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(10_000)); expect(mocks.create).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0]);
});

it('opens an existing pending order without creating another one', async () => {
  mocks.read.mockResolvedValue({ ...wallet, orders: [order] }); mocks.open.mockResolvedValue({ order, cashierOpened: true });
  await render();
  const continueButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.startsWith('继续付款'));
  await act(async () => continueButton?.click());
  expect(mocks.open).toHaveBeenCalledWith({ organizationId: org, order: order.reference });
  expect(mocks.create).not.toHaveBeenCalled();
});

it('allows another recharge of the same amount after the first order settles', async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
  const firstRequest = mocks.create.mock.calls[0][0].requestId;
  mocks.read.mockResolvedValue({ ...wallet, orders: [{ ...order, status: 'success' }] });
  await button('刷新');
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls[1][0].requestId).not.toBe(firstRequest);
});

it('does not represent unavailable balance as zero or offer unauthorized payment controls', async () => {
  mocks.read.mockResolvedValue({ ...wallet, canTopup: false, balance: { ...wallet.balance, availableCredits: 0, syncStatus: 'unavailable' } });
  await render(); expect(host.querySelector('.text-2xl')?.textContent).toBe('—');
  expect(host.textContent).toContain('无充值权限'); expect(host.querySelector('form')).toBeNull();
});

it('shows a missing web adapter honestly and stops polling when the panel closes', async () => {
  mocks.read.mockRejectedValue(new Error("Error invoking remote method 'reizo:account-wallet': Error: 网页服务尚未启用客户端充值"));
  await render(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('尚未启用');
  expect(host.textContent).not.toContain('Error invoking remote method');
  expect(host.querySelector('button[type="submit"]')).toBeNull();
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(mocks.read).toHaveBeenCalledOnce();
});
