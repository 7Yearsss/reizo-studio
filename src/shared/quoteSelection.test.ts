import { expect, test } from 'vitest';
import { appendQuote, formatQuote, MAX_QUOTE_CHARS } from './quoteSelection';

test('formats every line as a blockquote and leaves room to type', () => {
  expect(formatQuote('第一行\n\n第三行')).toBe('> 第一行\n>\n> 第三行\n\n');
  expect(formatQuote('  \n ')).toBe('');
});

test('very long selections are clipped', () => {
  const out = formatQuote('x'.repeat(MAX_QUOTE_CHARS + 50));
  expect(out.endsWith('…\n\n')).toBe(true);
  expect(out.length).toBe(2 + MAX_QUOTE_CHARS + 1 + 2);
});

test('appends below an existing draft', () => {
  expect(appendQuote('', '> a\n\n')).toBe('> a\n\n');
  expect(appendQuote('先说一句  ', '> a\n\n')).toBe('先说一句\n\n> a\n\n');
  expect(appendQuote('keep', '')).toBe('keep');
});
