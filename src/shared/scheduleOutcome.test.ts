import { expect, test } from 'vitest';
import { pausedRepairHint, runOutcomeDisplay } from './scheduleOutcome';

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
