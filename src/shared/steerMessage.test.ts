import { expect, test } from 'vitest';
import { isSteeredMessage, STEER_ID_PREFIX } from './steerMessage';

test('recognises mid-turn steers by their client id', () => {
  expect(isSteeredMessage(`${STEER_ID_PREFIX}1730-ab12c`)).toBe(true);
  expect(isSteeredMessage('local-1730')).toBe(false);
  expect(isSteeredMessage(undefined)).toBe(false);
});
