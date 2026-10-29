import { expect, test } from 'vitest';
import { approvalKeyAction } from './approvalKeys';

const base = { ctrlKey: false, metaKey: false };

test('Enter approves only when nothing interactive is focused', () => {
  expect(approvalKeyAction({ ...base, key: 'Enter', target: { tag: 'BODY' } })).toBe('allow');
  expect(approvalKeyAction({ ...base, key: 'Enter', ctrlKey: true, target: null })).toBe('allow-session');
});

test('Enter yields to typing, IME composition and focused buttons', () => {
  expect(approvalKeyAction({ ...base, key: 'Enter', target: { tag: 'DIV', editable: true } })).toBeNull();
  expect(approvalKeyAction({ ...base, key: 'Enter', target: { tag: 'TEXTAREA' } })).toBeNull();
  expect(approvalKeyAction({ ...base, key: 'Enter', target: { tag: 'BUTTON' } })).toBeNull();
  expect(approvalKeyAction({ ...base, key: 'Enter', isComposing: true, target: null })).toBeNull();
  expect(approvalKeyAction({ ...base, key: 'Enter', defaultPrevented: true, target: null })).toBeNull();
});

test('Escape denies except while composing, even from inputs', () => {
  expect(approvalKeyAction({ ...base, key: 'Escape', target: { tag: 'TEXTAREA' } })).toBe('deny');
  expect(approvalKeyAction({ ...base, key: 'Escape', isComposing: true })).toBeNull();
});

test('other keys are ignored', () => {
  expect(approvalKeyAction({ ...base, key: 'a' })).toBeNull();
});
