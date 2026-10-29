import { expect, test } from 'vitest';
import { workDuration } from './messagePersister';

test('reported duration excludes time spent waiting on the user', () => {
  expect(workDuration(60_000, 45_000)).toBe(15_000);
});

test('never negative, tolerates fractional waits', () => {
  expect(workDuration(1_000, 5_000)).toBe(0);
  expect(workDuration(1_000.4, 0.2)).toBe(1_000);
});
