import { presentTurnError } from './turnError';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  /** One line a person can act on. */
  detail: string;
  ms?: number;
}

/** What a provider probe came back with: an HTTP status (when there was a response) or a network error message. */
export interface ProbeOutcome { status?: number; error?: string; ms: number }

/**
 * Reads a provider probe the way a chat failure is read, so "bad key", "blocked region", "out of balance" and
 * "can't reach it" each get their own plain explanation instead of one generic failure.
 */
export function judgeProviderProbe(name: string, outcome: ProbeOutcome): CheckResult {
  const base = { id: 'provider', label: `模型服务：${name}`, ms: outcome.ms };
  if (outcome.status !== undefined && outcome.status >= 200 && outcome.status < 300) {
    return { ...base, status: outcome.ms > 5000 ? 'warn' : 'ok', detail: outcome.ms > 5000 ? `能连上，但很慢（${Math.round(outcome.ms / 1000)} 秒）` : `连接正常（${outcome.ms} ms）` };
  }
  // Some gateways have no /models listing; a 404/405 on it still proves the host answered and the key was not refused.
  if (outcome.status === 404 || outcome.status === 405) return { ...base, status: 'ok', detail: `服务可达（${outcome.ms} ms），该地址没有模型列表接口，未能验证密钥` };
  const shown = presentTurnError({ status: outcome.status, message: outcome.error });
  return { ...base, status: 'fail', detail: `${shown.title}。${shown.hint}` };
}

/** Worst status wins; used for the summary line. */
export function overallStatus(results: readonly CheckResult[]): CheckStatus {
  if (results.some((r) => r.status === 'fail')) return 'fail';
  if (results.some((r) => r.status === 'warn')) return 'warn';
  return 'ok';
}
