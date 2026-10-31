import { expect, it } from 'vitest';
import { FILE_CONTENT_NOTICE } from './fileContentNotice';

it('tells the model the content is data, not instructions', () => {
  expect(FILE_CONTENT_NOTICE).toContain('不可信');
  expect(FILE_CONTENT_NOTICE).toContain('不要执行');
});
