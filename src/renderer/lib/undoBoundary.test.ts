// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { undo } from '@tiptap/pm/history';
import { expect, test } from 'vitest';
import { closeUndoGroup } from './undoBoundary';

function makeEditor(): Editor {
  return new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '' });
}
const text = (e: Editor): string => e.getText();

test('typing merges into one undo step, as usual', () => {
  const e = makeEditor();
  for (const ch of 'hello') e.commands.insertContent(ch);
  expect(text(e)).toBe('hello');
  undo(e.state, e.view.dispatch);
  expect(text(e)).toBe('');
  e.destroy();
});

test('a change made between two closeUndoGroup calls is undone on its own', () => {
  const e = makeEditor();
  for (const ch of 'hello ') e.commands.insertContent(ch);
  closeUndoGroup(e.view);
  e.commands.insertContent('[chip]');
  closeUndoGroup(e.view);
  for (const ch of 'world') e.commands.insertContent(ch);
  expect(text(e)).toBe('hello [chip]world');
  undo(e.state, e.view.dispatch);
  expect(text(e)).toBe('hello [chip]');
  undo(e.state, e.view.dispatch);
  expect(text(e)).toBe('hello ');
  undo(e.state, e.view.dispatch);
  expect(text(e)).toBe('');
  e.destroy();
});
