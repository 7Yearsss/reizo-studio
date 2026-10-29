import { expect, test } from 'vitest';
import { partialStringFields } from './partialJson';

const BS = String.fromCharCode(92);

test('reads completed string fields from an unfinished object', () => {
  expect(partialStringFields('{"path":"src/a.ts","content":"hel', ['path', 'content'])).toEqual({ path: 'src/a.ts', content: 'hel' });
});

test('keys not reached yet are absent', () => {
  expect(partialStringFields('{"pa', ['path'])).toEqual({});
  expect(partialStringFields('{"path":"x"', ['command'])).toEqual({});
});

test('decodes escapes', () => {
  const text = `{"command":"echo ${BS}"hi${BS}"${BS}nls`;
  expect(partialStringFields(text, ['command'])).toEqual({ command: 'echo "hi"\nls' });
});

test('a dangling or incomplete escape is dropped, not mangled', () => {
  expect(partialStringFields(`{"command":"a${BS}`, ['command'])).toEqual({ command: 'a' });
  expect(partialStringFields(`{"p":"${BS}u00e9${BS}u00`, ['p'])).toEqual({ p: String.fromCharCode(0xe9) });
});

test('a key that merely starts with the wanted name does not match', () => {
  expect(partialStringFields('{"pathology":"x"}', ['path'])).toEqual({});
});

test('non-string values are skipped', () => {
  expect(partialStringFields('{"path":12,"command":"ls"}', ['path', 'command'])).toEqual({ command: 'ls' });
});
