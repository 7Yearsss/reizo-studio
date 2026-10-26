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
 *   3. The same *tool* errored K times within the recent window, regardless of
 *      args. Catches the "vary the file name / size / format and retry" loop
 *      (an agent trying to read_file a PNG 80+ times through ever-different
 *      converted copies), which dodges both (1) — interleaved successful
 *      write_file/run_command reset the streak — and (2) — every signature is
 *      new. Reset only by a successful *mutating* call of that same tool;
 *      other tools' successes don't count, and old entries slide out of the
 *      window.
 *
 * Two tiers: `warn` surfaces a banner ("this run may be stuck"); `halt` means
 * the caller should abort the turn / fail the node.
 */

export type ToolErrorKind =
  | 'bad_input'
  | 'timeout'
  | 'missing_capability'
  | 'permission'
  | 'unreadable_binary'
  | 'not_found'
  | 'unknown';

export interface ToolOutcome {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** Optional error text for error classification and recovery hints (Harness² A7). */
  error?: string;
  /** Did this call change state (write/edit/run/mutate)? Defaults by name. */
  mutating?: boolean;
  /**
   * Hash of the result (see `hashResult`). Successful repeats only count as a
   * loop when the result is also unchanged — polling a changing job is progress.
   */
  resultHash?: string;
}

export interface ToolLoopVerdict {
  tier: 'ok' | 'warn' | 'halt';
  reason: string;
  /** Classified failure category when the latest failures carried error text. */
  errorKind?: ToolErrorKind;
  /** Actionable recovery hint for the agent/user based on `errorKind`. */
  hint?: string;
}

/**
 * Harness² A7: Classify a tool error string into a structured failure category
 * with an actionable recovery hint so the agent changes strategy instead of blind-retrying.
 */
export function classifyToolError(
  error: string | undefined,
  toolName?: string,
): { kind: ToolErrorKind; hint: string } {
  const msg = (error ?? '').toLowerCase();
  if (!msg) return { kind: 'unknown', hint: '请检查工具参数或换一种方式完成任务。' };
  if (/binary|utf-8|not a text file|cannot read binary/i.test(msg)) {
    return {
      kind: 'unreadable_binary',
      hint: `${toolName ?? '该工具'} 仅支持 UTF-8 文本，不能直接读取二进制媒体/Office 文件；请改用对应的专用工具（如 read_sheet / read_document / read_presentation）或直接结束检查。`,
    };
  }
  if (/timeout|timed out|etimedout|deadline|超时/i.test(msg)) {
    return {
      kind: 'timeout',
      hint: '命令或工具执行超时；请缩小单次处理范围、避免交互式阻塞命令，或拆分步骤执行。',
    };
  }
  if (/permission|denied|eacces|eperm|not allowed|拒绝/i.test(msg)) {
    return {
      kind: 'permission',
      hint: '权限受限或用户拒绝了该操作；请勿重复发起相同请求，向用户说明情况或采用无需该权限的替代方案。',
    };
  }
  if (/command not found|is not recognized|no such tool|missing_capability|not installed|未安装|找不到命令/i.test(msg)) {
    return {
      kind: 'missing_capability',
      hint: '当前环境缺少该命令或依赖；请勿反复重试同一命令，改用工作区内置工具或现有环境已安装的命令。',
    };
  }
  if (/invalid|schema|expected|missing required|no match|target.*not found|参数|格式无效|版本已变化/i.test(msg)) {
    return {
      kind: 'bad_input',
      hint: '输入参数或目标匹配不合法；请先重新读取最新内容与版本号，核对字段格式后再调用。',
    };
  }
  if (/enoent|no such file|not found|未找到|不存在/i.test(msg)) {
    return {
      kind: 'not_found',
      hint: '目标文件或实体不存在；请先用 find_files / list_dir 或不带 ID 的列表工具确认真实路径/ID，不要猜测名称。',
    };
  }
  return { kind: 'unknown', hint: '同一调用反复失败；请停止重复尝试，切换工具或直接向用户说明阻碍。' };
}

export interface ToolLoopThresholds {
  consecutiveWarn: number;
  consecutiveHalt: number;
  signatureWarn: number;
  signatureHalt: number;
  toolWarn: number;
  toolHalt: number;
  /** How many recent outcomes count toward the per-tool failure tally. */
  toolWindow: number;
}

export const DEFAULT_TOOL_LOOP_THRESHOLDS: ToolLoopThresholds = {
  consecutiveWarn: 3,
  consecutiveHalt: 6,
  signatureWarn: 3,
  signatureHalt: 5,
  toolWarn: 3,
  toolHalt: 5,
  toolWindow: 20,
};

export const MUTATING_TOOL_NAMES = new Set([
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

/** FNV-1a over the serialized result; only the hash is kept, never the content. */
export function hashResult(value: unknown): string {
  let text: string;
  try { text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''; } catch { text = String(value); }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

/** Call signature plus, for successes, the result hash — so identical calls with changing results differ. */
function fingerprint(o: ToolOutcome): string {
  const sig = toolSignature(o.name, o.args);
  return o.ok && o.resultHash ? `${sig}#${o.resultHash}` : sig;
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

/**
 * Diversity-collapse windows (ported from cindy's loop-guard). Catch loops
 * where every call *succeeds* — a model re-running the same few reads/greps
 * forever. Over the last N completed calls, if the count of distinct
 * `name+args` fingerprints is at or below `maxDistinct`, the agent is
 * spinning. L2 = ABAB ping-pong; L3 = ABCD rotation (added after a real
 * incident: 4 rotating Greps, 1000+ calls in one turn).
 */
const DIVERSITY_WINDOWS = [
  { window: 12, minPresent: 8, maxDistinct: 2, haltAt: 12, label: 'ABAB 往复调用' },
  { window: 16, minPresent: 12, maxDistinct: 4, haltAt: 16, label: 'ABCD 轮换调用' },
] as const;

function shortName(sig: string): string {
  return sig.split('(')[0];
}

function attachDiagnosis(
  verdict: ToolLoopVerdict,
  outcomes: ToolOutcome[],
): ToolLoopVerdict {
  const lastFailed = [...outcomes].reverse().find((o) => !o.ok && o.error);
  if (!lastFailed?.error) return verdict;
  const { kind, hint } = classifyToolError(lastFailed.error, lastFailed.name);
  return { ...verdict, errorKind: kind, hint };
}

export function inspectToolStream(
  outcomes: ToolOutcome[],
  thresholds: ToolLoopThresholds = DEFAULT_TOOL_LOOP_THRESHOLDS,
): ToolLoopVerdict {
  let consecutiveErrors = 0;
  const sigErrors = new Map<string, number>();
  let consecutiveIdentical = 0;
  let lastSig = '';
  let lastPrint = '';

  for (const o of outcomes) {
    const sig = toolSignature(o.name, o.args);
    const print = fingerprint(o);
    consecutiveIdentical = print === lastPrint ? consecutiveIdentical + 1 : 1;
    lastPrint = print;
    lastSig = sig;
    if (o.ok) {
      consecutiveErrors = 0;
      if (isMutating(o)) sigErrors.delete(sig);
      continue;
    }
    consecutiveErrors += 1;
    sigErrors.set(sig, (sigErrors.get(sig) ?? 0) + 1);
  }

  // L1: the same call (name+args) repeated verbatim, regardless of outcome.
  if (consecutiveIdentical >= 6) {
    return attachDiagnosis(
      { tier: 'halt', reason: `连续 ${consecutiveIdentical} 次完全相同的调用 ${shortName(lastSig)}` },
      outcomes,
    );
  }

  const worstSig = [...sigErrors.entries()].sort((a, b) => b[1] - a[1])[0];
  const sigCount = worstSig?.[1] ?? 0;

  const toolErrors = new Map<string, number>();
  for (const o of outcomes.slice(-thresholds.toolWindow)) {
    if (!o.ok) toolErrors.set(o.name, (toolErrors.get(o.name) ?? 0) + 1);
    else if (isMutating(o)) toolErrors.delete(o.name);
  }
  const worstTool = [...toolErrors.entries()].sort((a, b) => b[1] - a[1])[0];
  const toolCount = worstTool?.[1] ?? 0;

  if (consecutiveErrors >= thresholds.consecutiveHalt) {
    return attachDiagnosis({ tier: 'halt', reason: `${consecutiveErrors} 次工具调用连续失败` }, outcomes);
  }
  if (sigCount >= thresholds.signatureHalt) {
    return attachDiagnosis(
      { tier: 'halt', reason: `同一操作 ${shortName(worstSig[0])} 失败 ${sigCount} 次` },
      outcomes,
    );
  }
  if (toolCount >= thresholds.toolHalt) {
    return attachDiagnosis(
      { tier: 'halt', reason: `工具 ${worstTool[0]} 换参数反复失败 ${toolCount} 次` },
      outcomes,
    );
  }

  // L2 / L3: fingerprint-diversity collapse over the recent window.
  for (const spec of DIVERSITY_WINDOWS) {
    const slice = outcomes.slice(-spec.window);
    if (slice.length < spec.minPresent) continue;
    const distinct = new Set(slice.map(fingerprint)).size;
    if (distinct <= spec.maxDistinct) {
      const tier: ToolLoopVerdict['tier'] = slice.length >= spec.haltAt ? 'halt' : 'warn';
      return { tier, reason: `${spec.label}：最近 ${slice.length} 次调用只有 ${distinct} 种` };
    }
  }

  if (consecutiveErrors >= thresholds.consecutiveWarn) {
    return attachDiagnosis({ tier: 'warn', reason: `${consecutiveErrors} 次工具调用连续失败` }, outcomes);
  }
  if (sigCount >= thresholds.signatureWarn) {
    return attachDiagnosis(
      { tier: 'warn', reason: `同一操作 ${shortName(worstSig[0])} 反复失败 ${sigCount} 次` },
      outcomes,
    );
  }
  if (toolCount >= thresholds.toolWarn) {
    return attachDiagnosis(
      { tier: 'warn', reason: `工具 ${worstTool[0]} 换参数反复失败 ${toolCount} 次` },
      outcomes,
    );
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
