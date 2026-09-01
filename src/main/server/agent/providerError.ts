/**
 * Turn opaque provider/SDK failures into a message a person can act on.
 * Gateways such as new-api often wrap a Cloudflare 524 as `{ message: "openai_error" }`.
 */

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
  if (status === 401 || status === 403) {
    return `模型服务拒绝了请求（HTTP ${status}）。请检查 API 密钥。`;
  }
  if (status === 502 || status === 503) {
    return `上游暂时不可用（HTTP ${status}）${retryHint}。`;
  }
  if (status && opaque) return `模型请求失败（HTTP ${status}）${retryHint}。`;
  if (raw && !opaque) return raw;
  if (raw) return `模型请求失败（${raw}）${retryHint}。`;
  return '模型请求失败。';
}
