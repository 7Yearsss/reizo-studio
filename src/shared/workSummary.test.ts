import { expect, test } from 'vitest';
import { workSummaryLabel } from './workSummary';

test('joins outcome, duration and step count', () => {
  expect(workSummaryLabel({ outcome: 'completed', duration: '12s', steps: 5 })).toBe('工作完成 · 12s · 5 步');
  expect(workSummaryLabel({ outcome: 'error', duration: '1m 3s', steps: 2 })).toBe('工作失败 · 1m 3s · 2 步');
});

test('leaves out what is unknown', () => {
  expect(workSummaryLabel({ outcome: null, steps: 0 })).toBe('工作完成');
  expect(workSummaryLabel({ outcome: 'interrupted', duration: '3s', steps: 0 })).toBe('工作中断 · 3s');
});
