import { describe, expect, it } from 'vitest';
import { BASE_OUTPUT_CAP, nextOutputCap, BREAKER_AUTH_DISABLE_MS, BREAKER_COOLDOWN_MS, classifyCompactionFailure, compactLevel, createCompactBreaker, keepRecentTurnsFor } from './autoCompact';

describe('compactLevel', () => {
  it('tiers by window usage', () => {
    expect(compactLevel(50_000, 100_000)).toBe('ok');
    expect(compactLevel(65_000, 100_000)).toBe('warn');
    expect(compactLevel(80_000, 100_000)).toBe('compact');
    expect(compactLevel(90_000, 100_000)).toBe('urgent');
    expect(compactLevel(1, 0)).toBe('ok');
  });
  it('keeps fewer verbatim turns when urgent', () => {
    expect(keepRecentTurnsFor('compact')).toBe(2);
    expect(keepRecentTurnsFor('urgent')).toBe(1);
  });
});

describe('failure classification and breaker', () => {
  it('separates transient, auth and other failures', () => {
    expect(classifyCompactionFailure(new Error('HTTP 429 rate limit'))).toBe('transient');
    expect(classifyCompactionFailure(new Error('fetch failed'))).toBe('transient');
    expect(classifyCompactionFailure(new Error('401 Unauthorized'))).toBe('auth');
    expect(classifyCompactionFailure(new Error('Incorrect API key provided'))).toBe('auth');
    expect(classifyCompactionFailure(new Error('weird'))).toBe('other');
  });

  it('three real failures cool down for 5 minutes; transient ones never count', () => {
    let t = 1_000;
    const breaker = createCompactBreaker(() => t);
    for (let i = 0; i < 10; i++) breaker.recordFailure(new Error('429'));
    expect(breaker.canAttempt()).toBe(true);
    breaker.recordFailure(new Error('x')); breaker.recordFailure(new Error('x'));
    expect(breaker.canAttempt()).toBe(true);
    breaker.recordFailure(new Error('x'));
    expect(breaker.canAttempt()).toBe(false);
    t += BREAKER_COOLDOWN_MS + 1;
    expect(breaker.canAttempt()).toBe(true);
  });

  it('an auth failure disables it for 30 minutes; success resets the count', () => {
    let t = 0;
    const breaker = createCompactBreaker(() => t);
    breaker.recordFailure(new Error('403 forbidden'));
    expect(breaker.canAttempt()).toBe(false);
    t += BREAKER_AUTH_DISABLE_MS + 1;
    expect(breaker.canAttempt()).toBe(true);
    breaker.recordFailure(new Error('x')); breaker.recordFailure(new Error('x'));
    breaker.recordSuccess();
    breaker.recordFailure(new Error('x')); breaker.recordFailure(new Error('x'));
    expect(breaker.canAttempt()).toBe(true);
  });
});


describe('nextOutputCap', () => {
  it('starts at the base, doubles each time, and never passes the window minus a margin', () => {
    const first = nextOutputCap(undefined, 128_000);
    expect(first).toBe(BASE_OUTPUT_CAP);
    expect(nextOutputCap(first, 128_000)).toBe(BASE_OUTPUT_CAP * 2);
    expect(nextOutputCap(100_000, 128_000)).toBe(127_000);
    expect(nextOutputCap(127_000, 128_000)).toBe(127_000);
  });
  it('a small window still gets at least the base', () => {
    expect(nextOutputCap(undefined, 4_000)).toBe(BASE_OUTPUT_CAP);
  });
});
