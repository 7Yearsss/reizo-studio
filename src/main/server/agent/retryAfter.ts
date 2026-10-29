function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const UNIT_SECONDS: Record<string, number> = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };

/**
 * Seconds until a rate-limited request may be retried, from the structured source first (a Retry-After header:
 * delta-seconds or an HTTP date) and only then from phrases like "try again in 1m30s". Undefined when unknown.
 */
export function retryAfterSeconds(error: unknown, text = '', now = Date.now()): number | undefined {
  const headers = isRecord(error) ? (error.responseHeaders ?? error.headers) : undefined;
  let header: unknown;
  if (headers instanceof Map || (isRecord(headers) && typeof (headers as { get?: unknown }).get === 'function')) {
    header = (headers as { get(name: string): unknown }).get('retry-after');
  } else if (isRecord(headers)) {
    header = headers['retry-after'] ?? headers['Retry-After'];
  }
  if (typeof header === 'string' || typeof header === 'number') {
    const asNumber = Number(header);
    if (Number.isFinite(asNumber) && asNumber >= 0) return Math.ceil(asNumber);
    const date = Date.parse(String(header));
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - now) / 1000));
  }
  const match = /(?:try again|retry|resets?)\s+(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+)/i.exec(text);
  if (!match) return undefined;
  let total = 0;
  for (const part of match[1].matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi)) {
    total += Number(part[1]) * (UNIT_SECONDS[part[2].toLowerCase()] ?? 0);
  }
  return total > 0 ? Math.ceil(total) : undefined;
}

/** "约 45 秒" / "约 2 分钟" / "约 1 小时 5 分钟". */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `约 ${Math.max(1, seconds)} 秒`;
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return minutes === 0 || minutes === 60 ? `约 ${hours + (minutes === 60 ? 1 : 0)} 小时` : `约 ${hours} 小时 ${minutes} 分钟`;
}
