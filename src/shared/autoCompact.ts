/** Context-window assumption when the provider does not report one. Most current chat models offer at least this. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

export type CompactLevel = 'ok' | 'warn' | 'compact' | 'urgent';

/** <60% leave alone; 60–75% warn; 75–85% summarise before the next turn; >85% summarise and keep fewer turns verbatim. */
export function compactLevel(usedTokens: number, windowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS): CompactLevel {
  if (windowTokens <= 0) return 'ok';
  const ratio = usedTokens / windowTokens;
  if (ratio > 0.85) return 'urgent';
  if (ratio > 0.75) return 'compact';
  if (ratio > 0.6) return 'warn';
  return 'ok';
}

/** How many recent user turns stay verbatim for each level. */
export function keepRecentTurnsFor(level: CompactLevel): number {
  return level === 'urgent' ? 1 : 2;
}

export type FailureKind = 'transient' | 'auth' | 'other';

/** Rate limits, overload and network trouble say nothing about whether compaction works; bad credentials mean stop trying. */
export function classifyCompactionFailure(error: unknown): FailureKind {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|(invalid|incorrect|wrong|missing|expired).{0,12}(api.?)?key|authentication|鉴权|认证失败/i.test(text)) return 'auth';
  if (/\b(429|500|502|503|504|529)\b|rate.?limit|overload|timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network|限流|超时|繁忙/i.test(text)) return 'transient';
  return 'other';
}

export const BREAKER_MAX_FAILURES = 3;
export const BREAKER_COOLDOWN_MS = 5 * 60_000;
export const BREAKER_AUTH_DISABLE_MS = 30 * 60_000;

/** Stops automatic compaction from hammering a model that keeps failing it. */
export function createCompactBreaker(now: () => number = Date.now) {
  let failures = 0;
  let blockedUntil = 0;
  return {
    canAttempt(): boolean {
      return now() >= blockedUntil;
    },
    recordSuccess(): void {
      failures = 0;
      blockedUntil = 0;
    },
    recordFailure(error: unknown): void {
      const kind = classifyCompactionFailure(error);
      if (kind === 'transient') return;
      if (kind === 'auth') {
        blockedUntil = now() + BREAKER_AUTH_DISABLE_MS;
        return;
      }
      failures += 1;
      if (failures >= BREAKER_MAX_FAILURES) {
        blockedUntil = now() + BREAKER_COOLDOWN_MS;
        failures = 0;
      }
    },
  };
}

/** Output cap used on the first retry after a reply was cut off by the provider's default limit. */
export const BASE_OUTPUT_CAP = 8_192;

/**
 * The output limit for the next pass after a reply was truncated: double what was used (starting from a base, since the
 * provider's own default is unknown), never past the model's window minus a margin for the prompt. Once raised it stays raised.
 */
export function nextOutputCap(current: number | undefined, windowTokens: number): number {
  const ceiling = Math.max(BASE_OUTPUT_CAP, windowTokens - 1_000);
  return Math.min((current ?? BASE_OUTPUT_CAP / 2) * 2, ceiling);
}
