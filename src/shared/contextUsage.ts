import type { ChatMessage } from './chat';
import { isCompactBoundary } from './compactBoundary';

/** What the provider reported for the most recent request of a conversation (prompt it received, text it produced). */
export interface LastRequestUsage { inputTokens: number; outputTokens: number; /** ms epoch when the request was issued */ at: number }

/**
 * How many tokens the next request will carry. The provider's own count for the last request is the truth — it
 * includes the system prompt and tool definitions that a message-only estimate cannot see — so build on that and
 * estimate only what was said after the reply. Anything that changed the history since (a compaction) or a missing
 * report falls back to the plain estimate rather than guessing from a stale number.
 */
export function contextTokens(messages: ChatMessage[], estimate: (messages: ChatMessage[]) => number, last: LastRequestUsage | null | undefined): { tokens: number; source: 'reported' | 'estimated' } {
  const estimated = { tokens: estimate(messages), source: 'estimated' as const };
  if (!last || !(last.inputTokens > 0)) return estimated;
  const stamp = (m: ChatMessage): number => Date.parse(m.createdAt);
  if (messages.some((m) => isCompactBoundary(m) && stamp(m) > last.at)) return estimated;
  const replyIndex = messages.findIndex((m) => m.role === 'assistant' && stamp(m) >= last.at);
  if (replyIndex < 0) return estimated;
  const after = messages.slice(replyIndex + 1);
  return { tokens: last.inputTokens + Math.max(0, last.outputTokens) + estimate(after), source: 'reported' };
}
