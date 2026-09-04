/**
 * Lightweight token estimation and context budgeting for agent sessions.
 * Focusing on fast heuristics for context window threshold triggering,
 * without inaccurate hardcoded USD pricing.
 */

/**
 * Fast heuristic to estimate tokens from a text string.
 * Uses a character count heuristic: ~3.5 chars/token for English-heavy content,
 * ~2 chars/token for CJK-heavy content.
 *
 * @param text The text to estimate tokens for
 * @returns Estimated number of tokens
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      nonAscii++;
    }
  }

  const isCjkHeavy = nonAscii > text.length * 0.2;
  return isCjkHeavy ? Math.ceil(text.length / 2) : Math.ceil(text.length / 3.5);
}

/**
 * Estimates tokens for an array of model messages.
 *
 * @param messages Array of messages with role and content
 * @returns Estimated number of tokens for all messages
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string | unknown }>,
): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else {
      total += estimateTokens(JSON.stringify(msg.content));
    }
    // Base formatting tokens per message
    total += 4;
  }
  return total > 0 ? total + 2 : 0;
}

/**
 * Helper to decide if the context window should be compacted.
 *
 * @param estimatedTokens Currently estimated context tokens
 * @param contextWindow Maximum context window size (e.g. 128_000)
 * @param threshold Fraction of the window (default 0.7 = 70%) that triggers compaction
 * @returns true if compaction should occur
 */
export function shouldAutoCompact(
  estimatedTokens: number,
  contextWindow: number,
  threshold = 0.7,
): boolean {
  if (contextWindow <= 0) return false;
  return estimatedTokens / contextWindow > threshold;
}

/**
 * Snapshot of session token usage.
 */
export interface TokenUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turnCount: number;
}

/**
 * Simple tracker for session token consumption across turns.
 */
export function createTokenTracker() {
  let inputTokens = 0;
  let outputTokens = 0;
  let turnCount = 0;

  return {
    recordTurn(usage: { inputTokens?: number; outputTokens?: number }) {
      inputTokens += usage.inputTokens ?? 0;
      outputTokens += usage.outputTokens ?? 0;
      turnCount += 1;
    },
    snapshot(): TokenUsageSnapshot {
      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        turnCount,
      };
    },
    reset() {
      inputTokens = 0;
      outputTokens = 0;
      turnCount = 0;
    },
  };
}

