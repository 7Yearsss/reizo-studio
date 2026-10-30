import { expect, test } from 'vitest';
import { describe } from 'vitest';
import { missedDueAt, missedGraceMs, pausedRepairHint, runOutcomeDisplay } from './scheduleOutcome';

test('interrupted is neutral, failed is the only danger', () => {
  expect(runOutcomeDisplay('interrupted')).toEqual({ label: '中断', tone: 'neutral' });
  expect(runOutcomeDisplay('failed').tone).toBe('danger');
  expect(runOutcomeDisplay('succeeded').tone).toBe('ok');
});

test('paused hint picks one repair from the failure reason', () => {
  expect(pausedRepairHint('HTTP 401 Unauthorized')).toContain('密钥');
  expect(pausedRepairHint('model gpt-x not found')).toContain('受支持的模型');
  expect(pausedRepairHint('429 rate limit')).toContain('额度');
  expect(pausedRepairHint(null)).toContain('运行记录');
});

describe('missed runs', () => {
  const hour = 3_600_000;
  test('a run that starts within its grace is not missed', () => {
    const due = new Date(0).toISOString();
    expect(missedDueAt(due, 2 * 60_000, hour)).toBeUndefined();
    expect(missedDueAt(due, 14 * 60_000, hour)).toBeUndefined();
  });
  test('a run that starts well after it was due reports the original time', () => {
    const due = new Date(0).toISOString();
    expect(missedDueAt(due, 3 * hour, hour)).toBe(due);
  });
  test('grace scales with the interval but stays between 5 minutes and 6 hours', () => {
    expect(missedGraceMs(60_000)).toBe(5 * 60_000);
    expect(missedGraceMs(24 * hour)).toBe(6 * hour);
    expect(missedGraceMs(4 * hour)).toBe(hour);
  });
  test('ignores an unreadable due time', () => {
    expect(missedDueAt('nope', Date.now(), hour)).toBeUndefined();
  });
});
