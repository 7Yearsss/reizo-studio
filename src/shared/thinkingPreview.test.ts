import { expect, test } from 'vitest';
import { lastCompleteSentence } from './thinkingPreview';

test('returns the last finished sentence, ignoring a trailing fragment', () => {
  expect(lastCompleteSentence('先看文件结构。再读配置。接着对比')).toBe('再读配置。');
});

test('empty until a sentence completes', () => {
  expect(lastCompleteSentence('')).toBe('');
  expect(lastCompleteSentence('正在分析')).toBe('');
});

test('handles english periods and newlines', () => {
  expect(lastCompleteSentence('Check the config. Then compare it.\nnext')).toBe('Then compare it.');
});

test('does not split on decimals', () => {
  expect(lastCompleteSentence('Version 1.5 is used. ok')).toBe('Version 1.5 is used.');
});

test('long sentences are tail-truncated', () => {
  const out = lastCompleteSentence(`${'长'.repeat(200)}。`, 20);
  expect(out.startsWith('…')).toBe(true);
  expect(out.length).toBe(21);
});
