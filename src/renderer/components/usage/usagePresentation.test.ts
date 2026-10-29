import { describe, expect, it } from 'vitest';
import { quotaPace, usageHighlights, usageLoadFailureText, usageStatus } from './usagePresentation';
import type { UsageMetric } from '../../../shared/usage';

it('prefers reported quantities over overlapping observations and keeps cache within input tokens', () => {
  const metrics: UsageMetric[] = [
    { metric: 'images', unit: 'image', quantity: 1, source: 'observed_output' },
    { metric: 'images', unit: 'image', quantity: 2, source: 'provider_reported' },
    { metric: 'input_tokens', unit: 'token', quantity: 1000, source: 'provider_reported' },
    { metric: 'output_tokens', unit: 'token', quantity: 20, source: 'provider_reported' },
    { metric: 'total_tokens', unit: 'token', quantity: 1020, source: 'provider_reported' },
    { metric: 'cached_input_tokens', unit: 'token', quantity: 800, source: 'provider_reported' },
  ];
  expect(usageHighlights({ category: 'image', metrics })).toEqual(['2 张图片', '输入 1,000 · 输出 20 Token', '其中缓存读取 800 Token']);
  expect(usageHighlights({ category: 'image', metrics: [] })).toEqual([]);
  expect(usageHighlights({ category: 'llm', metrics: [{ metric: 'input_tokens', quantity: Number.MAX_SAFE_INTEGER, unit: 'token', source: 'provider_reported' }] })).toEqual(['输入 9,007,199,254,740,991 Token']);
});

it('does not mistake a complete usage report for a successfully completed media task', () => {
  expect(usageStatus({ jobStatus: 'failed', usageState: 'reported' })).toEqual({ label: '失败', tone: 'danger' });
  expect(usageStatus({ usageState: 'reported', reportOutcomes: ['completed'] }).label).toBe('用量已报告');
  expect(usageStatus({ usageState: 'unknown' }).label).toBe('用量未报告');
});

describe('usageLoadFailureText', () => {
  it('never reads as "no limit"', () => {
    expect(usageLoadFailureText('')).toBe('无法加载用量，这不代表没有用量或限额。');
    expect(usageLoadFailureText('超时')).toBe('超时。无法加载用量，这不代表没有用量或限额。');
  });
});

describe('quotaPace', () => {
  const base = { limit: 100, windowStartMs: 0, windowEndMs: 1000 };
  it('is unknown without a usable limit or window', () => {
    expect(quotaPace({ ...base, limit: 0, used: 1, nowMs: 100 })).toEqual({ state: 'unknown' });
    expect(quotaPace({ ...base, windowEndMs: 0, used: 1, nowMs: 100 })).toEqual({ state: 'unknown' });
  });
  it('stays quiet under 3% used', () => {
    expect(quotaPace({ ...base, used: 2, nowMs: 10 })).toEqual({ state: 'ok' });
  });
  it('projects exhaustion before reset', () => {
    expect(quotaPace({ ...base, used: 50, nowMs: 250 })).toEqual({ state: 'exhausts', atMs: 500 });
  });
  it('is ok when the pace lasts past reset', () => {
    expect(quotaPace({ ...base, used: 10, nowMs: 500 })).toEqual({ state: 'ok' });
  });
  it('reports an already exhausted window as now', () => {
    expect(quotaPace({ ...base, used: 100, nowMs: 400 })).toEqual({ state: 'exhausts', atMs: 400 });
  });
});
