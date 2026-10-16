import { expect, it } from 'vitest';
import { GUIDE_CATEGORIES, insertGuidePrompt } from './conversationGuideData';

it('replaces untouched templates but preserves edits and avoids repeated insertion', () => {
  const [first, second] = GUIDE_CATEGORIES[1].tools;
  expect(insertGuidePrompt('', null, first)).toBe(first.prompt);
  expect(insertGuidePrompt(first.prompt, first, second)).toBe(second.prompt);
  const edited = `${first.prompt}我自己的主题`;
  const changed = insertGuidePrompt(edited, first, second);
  expect(changed).toBe(`${edited}\n\n${second.prompt}`);
  expect(insertGuidePrompt(changed, second, second)).toBe(changed);
});
