/**
 * Harness² D2: Per-category token/call ledger with budget identity verification.
 * Tracks main LLM passes, sub-agent delegations, memory jobs (recall + extraction),
 * canvas generation nodes, and candidate selector passes separately, and verifies
 * `totalCost === sum(categories)` and `totalTokens === sum(categories)`.
 */

export type LedgerCategory = 'llm' | 'subagent' | 'memory' | 'canvas' | 'selector';

export interface LedgerEntry {
  category: LedgerCategory;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LedgerSnapshot {
  byCategory: Record<LedgerCategory, LedgerEntry>;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  identityValid: boolean;
}

const CATEGORIES: LedgerCategory[] = ['llm', 'subagent', 'memory', 'canvas', 'selector'];

export function createTurnLedger() {
  const byCategory: Record<LedgerCategory, LedgerEntry> = {
    llm: { category: 'llm', calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    subagent: { category: 'subagent', calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    memory: { category: 'memory', calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    canvas: { category: 'canvas', calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    selector: { category: 'selector', calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };

  return {
    record(input: {
      category: LedgerCategory;
      calls?: number;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
    }) {
      const bucket = byCategory[input.category];
      bucket.calls += input.calls ?? 1;
      bucket.inputTokens += input.inputTokens ?? 0;
      bucket.outputTokens += input.outputTokens ?? 0;
      bucket.costUsd = roundUsd(bucket.costUsd + (input.costUsd ?? 0));
    },
    snapshot(): LedgerSnapshot {
      let totalCalls = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;
      for (const cat of CATEGORIES) {
        const b = byCategory[cat];
        totalCalls += b.calls;
        totalTokens += b.inputTokens + b.outputTokens;
        totalCostUsd = roundUsd(totalCostUsd + b.costUsd);
      }
      const sumTokens = CATEGORIES.reduce((acc, c) => acc + byCategory[c].inputTokens + byCategory[c].outputTokens, 0);
      const sumCost = roundUsd(CATEGORIES.reduce((acc, c) => acc + byCategory[c].costUsd, 0));
      return {
        byCategory: structuredClone(byCategory),
        totalCalls,
        totalTokens,
        totalCostUsd,
        identityValid: totalTokens === sumTokens && Math.abs(totalCostUsd - sumCost) < 1e-9,
      };
    },
  };
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
