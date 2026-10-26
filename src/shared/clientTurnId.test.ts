import { describe, expect, it } from 'vitest';
import { isDuplicateTurn, newClientTurnId, parseClientTurnId } from './clientTurnId';

describe('clientTurnId', () => {
  it('generates ids it accepts, and rejects odd input', () => {
    const id = newClientTurnId();
    expect(parseClientTurnId(id)).toBe(id);
    expect(newClientTurnId()).not.toBe(id);
    for (const bad of [undefined, 5, '', 'short', 'has space in it', 'x'.repeat(100)]) expect(parseClientTurnId(bad)).toBeUndefined();
  });

  it('a send whose id is already on a user message is a duplicate; assistant rows and other ids are not', () => {
    const messages = [{ role: 'user', clientId: 't-abc12345' }, { role: 'assistant', clientId: 't-other123' }, { role: 'user' }];
    expect(isDuplicateTurn(messages, 't-abc12345')).toBe(true);
    expect(isDuplicateTurn(messages, 't-other123')).toBe(false);
    expect(isDuplicateTurn(messages, 't-new00000')).toBe(false);
    expect(isDuplicateTurn(messages, undefined)).toBe(false);
  });
});
