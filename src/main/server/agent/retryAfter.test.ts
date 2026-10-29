import { expect, test } from 'vitest';
import { formatWait, retryAfterSeconds } from './retryAfter';

test('prefers the Retry-After header, as seconds or an HTTP date', () => {
  expect(retryAfterSeconds({ responseHeaders: { 'retry-after': '30' } })).toBe(30);
  expect(retryAfterSeconds({ headers: new Headers({ 'Retry-After': '12' }) })).toBe(12);
  const now = Date.parse('2026-01-01T00:00:00Z');
  expect(retryAfterSeconds({ responseHeaders: { 'retry-after': 'Thu, 01 Jan 2026 00:01:30 GMT' } }, '', now)).toBe(90);
});

test('falls back to phrases in the error text', () => {
  expect(retryAfterSeconds({}, 'Rate limit reached. Please try again in 1m30s.')).toBe(90);
  expect(retryAfterSeconds({}, 'try again in 20 seconds')).toBe(20);
  expect(retryAfterSeconds({}, 'resets in 2 hours 5 minutes')).toBe(7500);
});

test('is undefined when nothing says when', () => {
  expect(retryAfterSeconds({}, 'too many requests')).toBeUndefined();
  expect(retryAfterSeconds(null, '')).toBeUndefined();
});

test('formats waits for people', () => {
  expect(formatWait(20)).toBe('约 20 秒');
  expect(formatWait(90)).toBe('约 2 分钟');
  expect(formatWait(7500)).toBe('约 2 小时 5 分钟');
});
