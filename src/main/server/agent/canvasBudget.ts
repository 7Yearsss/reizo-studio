/**
 * Per-turn cap on canvas execution. Structure edits (add_node, edges,
 * proposals) are cheap and tracked loosely; `execute` counts calls that
 * actually burn a generation (run_node / run_graph / pipeline autorun) —
 * hitting that ceiling raises a budget checkpoint so a director-mode agent
 * can't spin up unlimited renders in one turn.
 */
export type CanvasBudgetKind = 'structural' | 'execute';

export interface CanvasBudget {
  /** Count one action of the given kind. */
  record(kind: CanvasBudgetKind): void;
  /** True once `record` has pushed the kind past its ceiling. */
  exceeded(kind: CanvasBudgetKind): boolean;
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
    record(kind) {
      counts[kind] += 1;
    },
    exceeded(kind) {
      return kind === 'execute' ? counts.execute > executeLimit : counts.structural > structuralLimit;
    },
    counts() {
      return { ...counts };
    },
    extendExecute(by) {
      executeLimit = Math.max(executeLimit, counts.execute - 1 + by);
    },
  };
}
