import { expect, test } from 'vitest';
import { MAX_PERSISTED_QUEUE_BYTES, parseQueues, serializeQueues } from './queuePersistence';

import type { PersistedQueuedTurn } from './queuePersistence';

const turn = (id: string, text = 'hi'): PersistedQueuedTurn => ({ id, text, mentions: [], extra: {} });

test('round-trips non-empty queues only', () => {
  const json = serializeQueues({ a: [turn('1')], b: [], c: undefined });
  expect(parseQueues(json)).toEqual({ a: [turn('1')] });
});

test('malformed storage yields an empty queue, never a throw', () => {
  expect(parseQueues(null)).toEqual({});
  expect(parseQueues('not json')).toEqual({});
  expect(parseQueues(JSON.stringify({ a: [{ id: 1 }, turn('ok')], b: 'x' }))).toEqual({ a: [turn('ok')] });
});

test('oversized attachments are dropped but the message survives', () => {
  const big = { ...turn('1', 'keep me'), extra: { attachments: [{ name: 'f', content: 'x'.repeat(MAX_PERSISTED_QUEUE_BYTES) }] } };
  const parsed = parseQueues(serializeQueues({ a: [big] }));
  expect(parsed.a[0].text).toBe('keep me');
  expect(parsed.a[0].extra.attachments).toBeUndefined();
});
