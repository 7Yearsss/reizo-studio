import { expect, test } from 'vitest';
import { autoRetryLabel } from './retryLabel';

test('names the attempt and never exceeds the limit', () => {
  expect(autoRetryLabel(1, 2)).toBe('上游超时，正在自动重试（第 1/2 次）…');
  expect(autoRetryLabel(5, 2)).toBe('上游超时，正在自动重试（第 2/2 次）…');
});
