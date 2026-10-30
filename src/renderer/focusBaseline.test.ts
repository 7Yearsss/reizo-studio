import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'index.css'), 'utf8').replaceAll('\r\n', '\n');

it('buttons and links that drop the browser outline get a focus-visible replacement', () => {
  const rule = css.match(/:is\(button, a[^{]*\)\.outline-none:focus-visible[^{]*\{([^}]*)\}/);
  expect(rule, 'baseline focus rule').not.toBeNull();
  expect(rule![1]).toContain('outline: 2px solid');
});

it('leaves elements that bring their own ring alone', () => {
  expect(css).toContain(":not([class*='focus-visible:ring'])");
});
