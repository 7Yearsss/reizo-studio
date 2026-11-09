// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AccountBillingSection from './AccountBillingSection';
import type { AccountBilling } from '../../../shared/accountBilling';

const data: AccountBilling = { organization: { id: '11111111-1111-4111-8111-111111111111', name: 'Workspace' }, balance: { availableCredits: 12.5, usedCredits: 1 },
  billing: { creditsPerCny: 1, plan: { status: 'not_configured' }, allowBalanceFallback: true, settlementMode: 'legacy_balance' },
  usage: { status: 'ready', page: 1, pageSize: 20, total: 40, items: [{ id: 'charge', model: 'Actual model', createdAt: '2026-10-28T01:00:00Z', type: 'consume', credits: 0.000002, promptTokens: 10, completionTokens: 5, requestId: 'request', tokenName: '', funding: 'unreported' }] },
  pricing: { status: 'ready', updatedAt: '2026-10-28T01:00:00Z', items: [{ model: 'Actual model', status: 'priced', rates: [{ label: '输入', unit: '百万 Token', min: 2, max: 4 }] }] } };
let root: Root, host: HTMLDivElement;
const status = vi.fn(), billing = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  status.mockResolvedValue({ status: 'authenticated', user: { id: 'user' }, models: { organizationId: data.organization.id } }); billing.mockResolvedValue(data);
  vi.stubGlobal('reizo', { accountStatus: status, accountBilling: billing });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<AccountBillingSection />)); }
it('shows server-settled charges, small amounts and a genuinely unconfigured plan', async () => {
  await render(); expect(host.textContent).toContain('12.5'); expect(host.textContent).toContain('¥0.000002'); expect(host.textContent).toContain('待定价');
  expect(host.querySelector('table')?.textContent).toContain('Actual model'); expect(billing).toHaveBeenCalledWith({ page: 1, type: 'consume', organizationId: data.organization.id });
});
it('displays unknown charges as unsynced, while a valid zero stays zero', async () => {
  billing.mockResolvedValue({ ...data, usage: { ...data.usage, items: [{ ...data.usage.items[0], credits: null }, { ...data.usage.items[0], id: 'free', credits: 0 }] } });
  await render(); expect(host.querySelector('table')?.textContent).toContain('未同步'); expect(host.querySelector('table')?.textContent).toContain('¥0');
});
it('shows current model rates separately from settled history without recalculating old charges', async () => {
  await render();
  const tab = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(element => element.textContent === '模型定价');
  if (!tab) throw new Error('Missing pricing tab');
  await act(async () => { tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(host.textContent).toContain('2–4 / 百万 Token'); expect(host.textContent).toContain('当前账户模型费率');
  expect(billing).toHaveBeenCalledOnce();
});
it('clears private account data promptly on logout and refuses late replies from an older page', async () => {
  await render();
  let finish: (value: AccountBilling) => void;
  billing.mockReturnValueOnce(new Promise<AccountBilling>(resolve => { finish = resolve; }));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="下一页消费"]')?.click());
  status.mockResolvedValue({ status: 'signed-out' });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => finish(data));
  expect(host.textContent).not.toContain('Actual model'); expect(host.textContent).toContain('登录后查看账户消费');
});
