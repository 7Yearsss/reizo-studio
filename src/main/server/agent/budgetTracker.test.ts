import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessagesTokens,
  shouldAutoCompact,
  createTokenTracker,
} from './budgetTracker';

describe('budgetTracker', () => {
  describe('estimateTokens', () => {
    it('estimates English content using 3.5 divisor', () => {
      const text = 'A'.repeat(70);
      expect(estimateTokens(text)).toBe(20);
    });

    it('estimates CJK content using 2 divisor', () => {
      const text = '字'.repeat(20);
      expect(estimateTokens(text)).toBe(10);
    });

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('estimates token usage for an array of messages', () => {
      const messages = [
        { role: 'user', content: 'A'.repeat(35) }, // 10 tokens + 4 base
        { role: 'assistant', content: { key: 'val' } }, // length 13, ~4 tokens + 4 base
      ];
      const result = estimateMessagesTokens(messages);
      expect(result).toBeGreaterThan(20);
    });
  });

  describe('shouldAutoCompact', () => {
    it('returns true when over threshold', () => {
      expect(shouldAutoCompact(8000, 10000)).toBe(true);
    });

    it('returns false when under threshold', () => {
      expect(shouldAutoCompact(5000, 10000)).toBe(false);
    });

    it('returns false for 0 context window', () => {
      expect(shouldAutoCompact(5000, 0)).toBe(false);
    });

    it('respects custom threshold', () => {
      expect(shouldAutoCompact(5500, 10000, 0.5)).toBe(true);
      expect(shouldAutoCompact(5500, 10000, 0.6)).toBe(false);
    });
  });

  describe('createTokenTracker', () => {
    it('tracks token usage across turns', () => {
      const tracker = createTokenTracker();
      expect(tracker.snapshot().totalTokens).toBe(0);

      tracker.recordTurn({ inputTokens: 100, outputTokens: 50 });
      expect(tracker.snapshot()).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        turnCount: 1,
      });

      tracker.recordTurn({ inputTokens: 200, outputTokens: 80 });
      expect(tracker.snapshot().totalTokens).toBe(430);
      expect(tracker.snapshot().turnCount).toBe(2);

      tracker.reset();
      const snap = tracker.snapshot();
      expect(snap.totalTokens).toBe(0);
      expect(snap.turnCount).toBe(0);
    });
  });
});
