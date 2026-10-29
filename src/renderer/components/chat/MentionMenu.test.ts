import { expect, it } from 'vitest';
import { extractMentionQuery } from './MentionMenu';

it('an @ opens a mention at the start or after whitespace', () => {
  expect(extractMentionQuery('@')).toBe('');
  expect(extractMentionQuery('@ab')).toBe('ab');
  expect(extractMentionQuery('看看 @rea')).toBe('rea');
  expect(extractMentionQuery('第一行\n@x')).toBe('x');
});

it('an email address is not a mention', () => {
  expect(extractMentionQuery('联系我 test@example.com')).toBeNull();
  expect(extractMentionQuery('a@b')).toBeNull();
});

it('a finished mention followed by text is no longer a query', () => {
  expect(extractMentionQuery('@file.ts 解释一下')).toBeNull();
});
