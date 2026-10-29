// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { visibleText } from './visibleText';

it('skips style and script bodies but keeps all visible text in order', () => {
  const root = document.createElement('div');
  root.innerHTML = '<span>你好 </span><style>@keyframes x{from{a:1}}</style><b>世界</b><script>var a=1</script>';
  expect(visibleText(root)).toBe('你好 世界');
  expect(root.textContent).toContain('@keyframes');
});

it('works when the root itself is a plain text container', () => {
  const root = document.createElement('p');
  root.textContent = 'plain';
  expect(visibleText(root)).toBe('plain');
});
