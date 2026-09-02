/**
 * Harness-side stuck-agent detector. Pure and synchronous: feed it the
 * normalised stream of tool outcomes and it reports whether the run looks
 * stuck. Two independent triggers, mirroring the failure modes seen in
 * practice (an agent looping 80+ calls on an invented identifier):
 *
 *   1. N tool calls in a row all errored. Reset by any success.
 *   2. The same (tool, args-shape) signature errored K times. Reset only by a
 *      *successful mutating* call — a stuck agent re-reads the same file and
 *      retries the same wrong assumption, so a successful read is not progress.
 *
 * Two tiers: `warn` surfaces a banner ("this run may be stuck"); `halt` means
 * the caller should abort the turn / fail the node.
 */

export interface ToolOutcome {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** Did this call change state (write/edit/run/mutate)? Defaults by name. */
  mutating?: boolean;
}

export interface ToolLoopVerdict {
  tier: 'ok' | 'warn' | 'halt';
  reason: string;
}

export interface ToolLoopThresholds {
  consecutiveWarn: number;
  consecutiveHalt: number;
  signatureWarn: number;
  signatureHalt: number;
}

export const DEFAULT_TOOL_LOOP_THRESHOLDS: ToolLoopThresholds = {
  consecutiveWarn: 3,
  consecutiveHalt: 6,
  signatureWarn: 3,
  signatureHalt: 5,
};

const MUTATING_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'run_command',
  'memory_write',
  'add_node',
  'update_node',
  'connect_nodes',
  'delete_node',
  'run_node',
  'run_graph',
]);

function isMutating(o: ToolOutcome): boolean {
  return o.mutating ?? MUTATING_TOOL_NAMES.has(o.name);
}

/** Stable-ish signature: tool name + shallow arg keys + short scalar values. */
export function toolSignature(name: string, args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(args).sort()) {
    const v = args[key];
    if (v == null) parts.push(`${key}=`);
    else if (typeof v === 'string') parts.push(`${key}=${v.slice(0, 80)}`);
    else if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${key}=${String(v)}`);
    else parts.push(`${key}=[obj]`);
  }
  return `${name}(${parts.join('&')})`;
}

export function inspectToolStream(
  outcomes: ToolOutcome[],
  thresholds: ToolLoopThresholds = DEFAULT_TOOL_LOOP_THRESHOLDS,
): ToolLoopVerdict {
  let consecutiveErrors = 0;
  const sigErrors = new Map<string, number>();

  for (const o of outcomes) {
    const sig = toolSignature(o.name, o.args);
    if (o.ok) {
      consecutiveErrors = 0;
      if (isMutating(o)) sigErrors.delete(sig);
      continue;
    }
    consecutiveErrors += 1;
    sigErrors.set(sig, (sigErrors.get(sig) ?? 0) + 1);
  }

  const worstSig = [...sigErrors.entries()].sort((a, b) => b[1] - a[1])[0];
  const sigCount = worstSig?.[1] ?? 0;

  if (consecutiveErrors >= thresholds.consecutiveHalt) {
    return {
      tier: 'halt',
      reason: `${consecutiveErrors} 次工具调用连续失败`,
    };
  }
  if (sigCount >= thresholds.signatureHalt) {
    return {
      tier: 'halt',
      reason: `同一操作 ${worstSig[0].split('(')[0]} 失败 ${sigCount} 次`,
    };
  }
  if (consecutiveErrors >= thresholds.consecutiveWarn) {
    return { tier: 'warn', reason: `${consecutiveErrors} 次工具调用连续失败` };
  }
  if (sigCount >= thresholds.signatureWarn) {
    return {
      tier: 'warn',
      reason: `同一操作 ${worstSig[0].split('(')[0]} 反复失败 ${sigCount} 次`,
    };
  }
  return { tier: 'ok', reason: '' };
}

/**
 * Stateful wrapper for a running turn: keeps a bounded window of outcomes and
 * re-inspects after each record. Returns the verdict only when the tier
 * *rises* (ok→warn, warn→halt), so the caller emits one banner, not one per
 * tool call.
 */
export function createToolLoopGuard(thresholds?: ToolLoopThresholds) {
  const window: ToolOutcome[] = [];
  let lastTier: ToolLoopVerdict['tier'] = 'ok';
  const CAP = 40;

  return {
    record(outcome: ToolOutcome): ToolLoopVerdict | null {
      window.push(outcome);
      if (window.length > CAP) window.shift();
      const verdict = inspectToolStream(window, thresholds);
      const rank = { ok: 0, warn: 1, halt: 2 } as const;
      if (rank[verdict.tier] > rank[lastTier]) {
        lastTier = verdict.tier;
        return verdict;
      }
      // A clean success can de-escalate the window; let the tier fall silently.
      if (rank[verdict.tier] < rank[lastTier]) lastTier = verdict.tier;
      return null;
    },
    get tier() {
      return lastTier;
    },
  };
}
