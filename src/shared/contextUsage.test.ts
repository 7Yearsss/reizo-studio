import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './chat';
import { contextTokens } from './contextUsage';

const msg = (id: string, role: ChatMessage['role'], at: number, content = 'x'): ChatMessage => ({ id, role, content, createdAt: new Date(at).toISOString() }) as ChatMessage;
const estimate = (list: ChatMessage[]): number => list.length * 10;

describe('contextTokens', () => {
  const history = [msg('1', 'user', 1000), msg('2', 'assistant', 2000), msg('3', 'user', 3000)];
  it('builds on the provider-reported count and adds only what came after the reply', () => {
    expect(contextTokens(history, estimate, { inputTokens: 5000, outputTokens: 200, at: 1500 })).toEqual({ tokens: 5000 + 200 + 10, source: 'reported' });
  });
  it('falls back to the estimate without a report, or when the last request has no reply yet', () => {
    expect(contextTokens(history, estimate, null)).toEqual({ tokens: 30, source: 'estimated' });
    expect(contextTokens(history, estimate, { inputTokens: 0, outputTokens: 0, at: 1500 }).source).toBe('estimated');
    expect(contextTokens([msg('1', 'user', 1000)], estimate, { inputTokens: 9, outputTokens: 1, at: 1500 }).source).toBe('estimated');
  });
});
