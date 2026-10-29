import { afterEach, expect, test } from 'vitest';
import { confirmDialog, confirmStore, noticeDialog, resetConfirmStoreForTest } from './confirmStore';

afterEach(() => resetConfirmStoreForTest());

test('resolves with the settled value and advances the queue in order', async () => {
  const first = confirmDialog({ title: 'a' });
  const second = confirmDialog({ title: 'b' });
  expect(confirmStore.getSnapshot()?.title).toBe('a');
  confirmStore.settle(true);
  expect(await first).toBe(true);
  expect(confirmStore.getSnapshot()?.title).toBe('b');
  confirmStore.settle(false);
  expect(await second).toBe(false);
  expect(confirmStore.getSnapshot()).toBeNull();
});

test('notice dialog has no cancel button', async () => {
  const done = noticeDialog('x');
  expect(confirmStore.getSnapshot()?.cancelLabel).toBeNull();
  confirmStore.settle(true);
  await done;
});
