/**
 * Turn opaque provider/SDK failures into a message a person can act on.
 * Gateways such as new-api often wrap a Cloudflare 524 as `{ message: "openai_error" }`.
 */

import { classifyTurnError, presentTurnError, type TurnErrorKind } from '../../../shared/turnError';

/** Kinds whose wording comes from the shared presenter (they used to all read "check your API key"). */
const PRESENTED: ReadonlySet<TurnErrorKind> = new Set(['region_blocked', 'auth', 'quota', 'forbidden', 'model_not_found', 'content_filtered', 'context_too_long', 'payload_too_large']);

/** Everything the provider said, wherever the SDK put it, so classification sees the real reason behind a generic message. */
function providerText(error: unknown): string {
  const rec = isRecord(error) ? error : undefined;
  const nested = nestedError(error);
  return [
    error instanceof Error ? error.message : '',
    typeof rec?.message === 'string' ? rec.message : '',
    typeof nested?.message === 'string' ? nested.message : '',
    typeof nested?.code === 'string' ? nested.code : '',
    typeof rec?.responseBody === 'string' ? rec.responseBody : '',
    typeof error === 'string' ? error : '',
  ].join(' ');
}

const OPAQUE = new Set(['openai_error', 'bad_response_status_code', 'internal_error', 'error', '']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asStatus(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 100 && n < 600 ? n : undefined;
}

function nestedError(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const data = isRecord(value.data) ? value.data : undefined;
  if (data && isRecord(data.error)) return data.error;
  if (isRecord(value.error)) return value.error;
  return undefined;
}

function retryableStatus(status: number | undefined): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504 || status === 524;
}

export function formatProviderError(error: unknown): string {
  const rec = isRecord(error) ? error : undefined;
  const nested = nestedError(error);
  const status = asStatus(rec?.statusCode ?? rec?.status ?? nested?.status);
  const retryable = rec?.isRetryable === true || retryableStatus(status);
  const raw =
    (error instanceof Error && error.message) ||
    (typeof nested?.message === 'string' && nested.message) ||
    (typeof error === 'string' ? error : '') ||
    '';
  const opaque = OPAQUE.has(raw.trim().toLowerCase());
  const retryHint = retryable ? '，可以重试' : '';

  if (status === 524 || status === 504 || status === 408) {
    return `上游超时（HTTP ${status}）。网关在等待模型输出时断开了${retryHint}。`;
  }
  if (status === 429) return '请求过于频繁（HTTP 429）。请稍后再试。';
  const presented = classifyTurnError({ status, message: providerText(error) });
  if (PRESENTED.has(presented)) {
    const shown = presentTurnError({ status, message: providerText(error) });
    return `${shown.title}${status ? `（HTTP ${status}）` : ''}。${shown.hint}`;
  }
  if (status === 502 || status === 503) {
    return `上游暂时不可用（HTTP ${status}）${retryHint}。`;
  }
  if (status === 529 || /overloaded|at capacity|capacity/i.test(raw)) {
    return `模型服务当前过载${retryHint || '，请稍后重试'}。`;
  }
  if (status && opaque) return `模型请求失败（HTTP ${status}）${retryHint}。`;
  if (raw && !opaque) return raw;
  if (raw) return `模型请求失败（${raw}）${retryHint}。`;
  return '模型请求失败。';
}

export type ProviderErrorKind =
  | TurnErrorKind
  | 'timeout'
  | 'rate_limited'
  | 'capacity'
  | 'overloaded'
  | 'auth'
  | 'upstream'
  | 'unknown';

export interface ProviderErrorInfo {
  kind: ProviderErrorKind;
  /** Should a caller try again at all? */
  retryable: boolean;
  /**
   * Did the SDK / provider already retry internally? If so, a host-level
   * retry loop would amplify one overload into many billed requests — see
   * cindy's `overload-error.ts`. `overloaded` (Anthropic 529, SDK retries) is
   * true; `capacity` (OpenAI "at capacity", vendor does NOT self-retry) is
   * false, so the host should back off and re-dispatch.
   */
  alreadyRetriedBySdk: boolean;
  message: string;
}

/**
 * Structured companion to `formatProviderError`. Keeps `capacity` and
 * `overloaded` distinct because they have different retry owners.
 */
export function classifyProviderError(error: unknown): ProviderErrorInfo {
  const rec = isRecord(error) ? error : undefined;
  const nested = nestedError(error);
  const status = asStatus(rec?.statusCode ?? rec?.status ?? nested?.status);
  const raw = (
    (error instanceof Error && error.message) ||
    (typeof nested?.message === 'string' && nested.message) ||
    (typeof error === 'string' ? error : '') ||
    ''
  ).toLowerCase();
  const message = formatProviderError(error);

  const presented = classifyTurnError({ status, message: providerText(error) });
  if (PRESENTED.has(presented)) {
    return { kind: presented, retryable: false, alreadyRetriedBySdk: false, message };
  }
  if (status === 401 || status === 403 || /api key|unauthorized|invalid authentication/.test(raw)) {
    return { kind: 'auth', retryable: false, alreadyRetriedBySdk: false, message };
  }
  if (status === 529 || /\boverloaded\b/.test(raw)) {
    return { kind: 'overloaded', retryable: true, alreadyRetriedBySdk: true, message };
  }
  if (/at capacity|selected model is at capacity/.test(raw)) {
    return { kind: 'capacity', retryable: true, alreadyRetriedBySdk: false, message };
  }
  if (status === 429 || /rate limit|too many requests/.test(raw)) {
    return { kind: 'rate_limited', retryable: true, alreadyRetriedBySdk: false, message };
  }
  if (status === 408 || status === 504 || status === 524 || /timeout|timed out/.test(raw)) {
    return { kind: 'timeout', retryable: true, alreadyRetriedBySdk: false, message };
  }
  if (status === 502 || status === 503 || (typeof status === 'number' && status >= 500)) {
    return { kind: 'upstream', retryable: true, alreadyRetriedBySdk: false, message };
  }
  return { kind: 'unknown', retryable: rec?.isRetryable === true, alreadyRetriedBySdk: false, message };
}
