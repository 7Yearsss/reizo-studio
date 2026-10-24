// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { UsagePage, UsageRecord, UsageSummary } from '../../../shared/usage';
import UsageCostsSection from './UsageCostsSection';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), list: vi.fn(), prices: vi.fn(), open: vi.fn(), close: vi.fn(), mode: vi.fn() }));
vi.mock('../../api', () => ({ getUsageSummary: mocks.summary, listUsageRecords: mocks.list, listPricingSnapshots: mocks.prices }));
vi.mock('../../state/useSettingsStore', () => ({ useSettingsStore: (select: (value: unknown) => unknown) => select({ settings: { providers: [{ id: 'account', name: 'Reizo 账号' }] } }) }));
vi.mock('../../state/tabStore', () => ({ openChatTab: mocks.open }));
vi.mock('../../state/uiStore', () => ({ closeSettings: mocks.close, setMode: mocks.mode }));
vi.mock('./UsagePricingForm', () => ({ default: () => <div>价格表单</div> }));
vi.mock('./UsageBillForm', () => ({ default: () => <button>补充账单</button> }));
const summary: UsageSummary = { executionCount: 90, localCount: 0, supplierExecutionCount: 90, reportedCount: 80, partialCount: 0, observedCount: 0,
  unknownCount: 10, unreconciledCount: 90, billedCount: 0, estimatedOnlyCount: 0, unpricedCount: 90, metrics: [], estimates: [], bills: [] };
const record: UsageRecord = { id: 'one', executionId: 'execution', category: 'llm', providerId: 'account', model: 'chosen-model',
  sessionId: 'chat', sessionTitle: '雨夜车辆', createdAt: '2026-10-24T05:00:00Z', usageState: 'reported', reportCount: 1, unknownReportCount: 0,
  metrics: [{ metric: 'input_tokens', unit: 'token', quantity: 23439, source: 'provider_reported' }, { metric: 'output_tokens', unit: 'token', quantity: 41, source: 'provider_reported' }],
  estimateUnknownReason: '未设置明确价格快照', reconciliation: 'unreconciled' };
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  mocks.summary.mockResolvedValue(summary); mocks.list.mockResolvedValue({ records: [record] }); mocks.prices.mockResolvedValue([]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<UsageCostsSection onOpenProviders={vi.fn()} />)); }
async function select(label: string, value: string) {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!element) throw new Error('Missing filter');
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
it('shows actual counters, missing pricing reason and source directly instead of repeated unknown estimates', async () => {
  await render(); const table = host.querySelector('table');
  expect(table?.textContent).toContain('输入 23,439 · 输出 41 Token');
  expect(table?.textContent).toContain('缺少价格依据');
  expect(table?.textContent).toContain('雨夜车辆');
  expect(table?.textContent).not.toContain('估算未知');
  expect(host.textContent).toContain('90 条');
  expect(host.textContent).toContain('尚无账单');
  await act(async () => host.querySelector<HTMLButtonElement>('[title="返回对话：雨夜车辆"]')?.click());
  expect(mocks.open).toHaveBeenCalledWith('chat', '雨夜车辆'); expect(mocks.close).toHaveBeenCalled();
});

it('applies fee and type filters to both full totals and pagination requests', async () => {
  mocks.list.mockResolvedValue({ records: [record], nextCursor: 'next' });
  await render(); await select('费用状态', 'unpriced');
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="调用类型"] button')].find(button => button.textContent === '图片')?.click());
  expect(mocks.summary).toHaveBeenLastCalledWith({ category: 'image', cost: 'unpriced' });
  expect(mocks.list).toHaveBeenLastCalledWith({ category: 'image', cost: 'unpriced', limit: 40 });
  mocks.list.mockResolvedValue({ records: [{ ...record, id: 'two' }] });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '加载更多记录')?.click());
  expect(mocks.list).toHaveBeenLastCalledWith({ category: 'image', cost: 'unpriced', limit: 40, cursor: 'next' });
  expect(host.textContent).toContain('已加载 2 条');
});

it('ignores a late response from the previous filter', async () => {
  let resolve!: (page: UsagePage) => void;
  mocks.list.mockReturnValueOnce(new Promise<UsagePage>(yes => { resolve = yes; })).mockResolvedValue({ records: [{ ...record, id: 'new', model: 'image-result' }] });
  await render(); await select('费用状态', 'billed');
  await act(async () => resolve({ records: [{ ...record, model: 'stale-result' }] }));
  expect(host.querySelector('table')?.textContent).toContain('image-result');
  expect(host.querySelector('table')?.textContent).not.toContain('stale-result');
});

it('distinguishes a real zero bill from an unknown amount and keeps details available', async () => {
  mocks.list.mockResolvedValue({ records: [{ ...record, bill: { id: 'bill', executionId: 'execution', amount: 0, currency: 'CNY', source: 'waiver invoice', reference: 'line-1', createdAt: record.createdAt }, reconciliation: 'bill_recorded' }] });
  await render();
  expect(host.querySelector('table')?.textContent).toContain('CNY 0');
  expect(host.querySelector('table')?.textContent).toContain('已录入账单');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-expanded="false"]')?.click());
  expect(host.textContent).toContain('waiver invoice');
});

it('keeps readable records when pricing cannot be fetched and offers recovery', async () => {
  mocks.prices.mockRejectedValue(new Error('价格读取失败'));
  await render();
  expect(host.querySelector('table')?.textContent).toContain('chosen-model');
  expect(host.textContent).toContain('价格读取失败');
  expect(host.textContent).toContain('重新读取');
});

it('debounces search, shares date bounds with the overview, and can clear an empty result', async () => {
  await render(); await select('时间范围', 'today');
  const bounds = mocks.summary.mock.calls.at(-1)?.[0];
  expect(new Date(bounds.from).getHours()).toBe(0);
  expect(Date.parse(bounds.to)).toBeGreaterThan(Date.parse(bounds.from));
  mocks.list.mockResolvedValue({ records: [] });
  mocks.summary.mockResolvedValue({ ...summary, executionCount: 0 });
  const input = host.querySelector<HTMLInputElement>('[aria-label="搜索用量记录"]');
  if (!input) throw new Error('Missing search input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'missing-model');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(mocks.list).toHaveBeenLastCalledWith({ ...bounds, search: 'missing-model', limit: 40 });
  expect(host.textContent).toContain('没有符合筛选条件的记录');
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '清除筛选')?.click());
  expect(mocks.summary).toHaveBeenLastCalledWith({});
  expect(input.value).toBe('');
});
