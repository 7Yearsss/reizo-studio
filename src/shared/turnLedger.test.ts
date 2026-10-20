import { describe, expect, it } from 'vitest';
import { createTurnLedger } from './turnLedger';

describe('turnLedger (Harness² D2)', () => {
  it('tracks calls, tokens, and cost per category and verifies budget identity', () => {
    const ledger = createTurnLedger();
    ledger.record({ category: 'llm', inputTokens: 1200, outputTokens: 400, costUsd: 0.012 });
    ledger.record({ category: 'subagent', inputTokens: 800, outputTokens: 200, costUsd: 0.005 });
    ledger.record({ category: 'memory', inputTokens: 300, outputTokens: 100, costUsd: 0.001 });
    ledger.record({ category: 'canvas', calls: 2, costUsd: 0.08 });

    const snap = ledger.snapshot();
    expect(snap.totalCalls).toBe(5);
    expect(snap.totalTokens).toBe(3000);
    expect(snap.totalCostUsd).toBe(0.098);
    expect(snap.identityValid).toBe(true);
    expect(snap.byCategory.subagent.calls).toBe(1);
    expect(snap.byCategory.canvas.calls).toBe(2);
  });
});
