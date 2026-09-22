/**
 * Per-turn cap on canvas execution. Structure edits (add_node, edges,
 * proposals) are cheap and tracked loosely; `execute` counts calls that
 * actually burn a generation (run_node / run_graph / pipeline autorun) —
 * hitting that ceiling raises a budget checkpoint so a director-mode agent
 * can't spin up unlimited renders in one turn.
 */
export type CanvasBudgetKind = 'structural' | 'execute';

export interface CanvasBudget {
  /** Count `count` actions of the given kind (default 1 — a run_graph call counts its whole scope; negative refunds). */
  record(kind: CanvasBudgetKind, count?: number): void;
  /** True once `record` has pushed the kind past its ceiling. */
  exceeded(kind: CanvasBudgetKind): boolean;
  /** Pre-dispatch check: true if `count` more of the kind would pass the ceiling (doesn't record). */
  wouldExceed(kind: CanvasBudgetKind, count?: number): boolean;
  /** Current counts, for checkpoint messaging and tests. */
  counts(): Record<CanvasBudgetKind, number>;
  /** Extend the execute ceiling — called after the user approves a checkpoint. */
  extendExecute(by: number): void;
}

export const CANVAS_BUDGET_EXECUTE_LIMIT = 4;
export const CANVAS_BUDGET_STRUCTURAL_LIMIT = 50;
/** How many more executions a single "allow" grants past the current count. */
export const CANVAS_BUDGET_ALLOW_BATCH = 8;

export function createCanvasBudget(limits?: { execute?: number; structural?: number }): CanvasBudget {
  const counts: Record<CanvasBudgetKind, number> = { structural: 0, execute: 0 };
  let executeLimit = limits?.execute ?? CANVAS_BUDGET_EXECUTE_LIMIT;
  const structuralLimit = limits?.structural ?? CANVAS_BUDGET_STRUCTURAL_LIMIT;
  return {
    record(kind, count = 1) {
      counts[kind] += count;
    },
    exceeded(kind) {
      return kind === 'execute' ? counts.execute > executeLimit : counts.structural > structuralLimit;
    },
    wouldExceed(kind, count = 1) {
      return kind === 'execute' ? counts.execute + count > executeLimit : counts.structural + count > structuralLimit;
    },
    counts() {
      return { ...counts };
    },
    extendExecute(by) {
      executeLimit = Math.max(executeLimit, counts.execute + by);
    },
  };
}
