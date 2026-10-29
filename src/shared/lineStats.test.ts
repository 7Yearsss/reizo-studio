import { expect, test } from 'vitest';
import { lineStats } from './lineStats';

test('new and deleted files', () => {
  expect(lineStats('', 'a\nb\n')).toEqual({ added: 2, removed: 0 });
  expect(lineStats('a\nb\n', '')).toEqual({ added: 0, removed: 2 });
});

test('a changed line counts as one removed and one added', () => {
  expect(lineStats('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, removed: 1 });
});

test('inserts in the middle of unchanged text', () => {
  expect(lineStats('a\nd\n', 'a\nb\nc\nd\n')).toEqual({ added: 2, removed: 0 });
});

test('identical text and CRLF differences are not changes', () => {
  expect(lineStats('a\nb\n', 'a\r\nb\r\n')).toEqual({ added: 0, removed: 0 });
});

test('interleaved edits use the common subsequence, not a block replace', () => {
  expect(lineStats('a\nb\nc\nd\ne\n', 'a\nx\nc\ny\ne\n')).toEqual({ added: 2, removed: 2 });
});
