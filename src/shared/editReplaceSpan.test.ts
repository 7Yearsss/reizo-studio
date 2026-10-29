import { expect, test } from 'vitest';
import { replacedMessageCount } from './editReplaceSpan';

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

test('counts the edited message and everything after it', () => {
  expect(replacedMessageCount(list, 'c')).toBe(2);
  expect(replacedMessageCount(list, 'a')).toBe(4);
});

test('is zero when nothing is being edited or the id is gone', () => {
  expect(replacedMessageCount(list, undefined)).toBe(0);
  expect(replacedMessageCount(list, 'zzz')).toBe(0);
});
