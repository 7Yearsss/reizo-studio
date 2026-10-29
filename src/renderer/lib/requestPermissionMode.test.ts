import { expect, test } from 'vitest';
import { widensPermission } from './requestPermissionMode';

test('only moving up to full counts as widening', () => {
  expect(widensPermission('ask', 'full')).toBe(true);
  expect(widensPermission('workspace', 'full')).toBe(true);
  expect(widensPermission('full', 'full')).toBe(false);
  expect(widensPermission('full', 'workspace')).toBe(false);
  expect(widensPermission('ask', 'workspace')).toBe(false);
});
