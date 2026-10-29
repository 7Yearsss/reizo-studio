import { expect, it } from 'vitest';
import { userMessageText } from './userMessageText';

it('drops the appended canvas reference block and keeps what was typed', () => {
  const content = '这是啥\n\nReferenced canvas nodes:\n- IVNXAGdh22MRBw_mxtKFr [image, done] image.png';
  expect(userMessageText(content)).toBe('这是啥');
});

it('leaves ordinary text alone', () => {
  expect(userMessageText('  hello\nworld  ')).toBe('hello\nworld');
});
