import { describe, expect, it } from 'vitest';
import { failureReason, observeRetries, retryNotice } from './retryObserver';

const respond = (status: number) => (async () => new Response('x', { status })) as unknown as typeof fetch;

describe('retry observer', () => {
  it('words the notice with the attempt count and stops past the retry budget', () => {
    expect(retryNotice(1, 2, 'rate_limit')).toBe('请求被限流，正在重试 1/2…');
    expect(retryNotice(2, 2, 'network')).toContain('2/2');
    expect(retryNotice(3, 2, 'unavailable')).toBeNull();
    expect(retryNotice(0, 2, 'unavailable')).toBeNull();
  });

  it('classifies only 429 and 5xx as retryable upstream trouble', () => {
    expect(failureReason(429)).toBe('rate_limit');
    expect(failureReason(503)).toBe('unavailable');
    expect(failureReason(400)).toBeNull();
    expect(failureReason(200)).toBeNull();
  });

  it('announces each consecutive failure, and a success resets the count', async () => {
    const seen: string[] = [];
    let status = 503;
    const fetchLike = observeRetries((async () => new Response('x', { status })) as unknown as typeof fetch, { maxRetries: 2, announce: (t) => seen.push(t) });
    await fetchLike('http://x');
    await fetchLike('http://x');
    await fetchLike('http://x'); // beyond the budget: silent (the SDK gives up)
    status = 200;
    await fetchLike('http://x');
    status = 429;
    await fetchLike('http://x');
    expect(seen).toEqual(['模型服务暂时不可用，正在重试 1/2…', '模型服务暂时不可用，正在重试 2/2…', '请求被限流，正在重试 1/2…']);
  });

  it('counts thrown network errors but not user aborts', async () => {
    const seen: string[] = [];
    const boom = observeRetries((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, { maxRetries: 2, announce: (t) => seen.push(t) });
    await expect(boom('http://x')).rejects.toThrow('fetch failed');
    expect(seen).toEqual(['网络不稳定，正在重试 1/2…']);
    const abort = observeRetries((async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }) as unknown as typeof fetch, { maxRetries: 2, announce: (t) => seen.push(t) });
    await expect(abort('http://x')).rejects.toThrow('aborted');
    expect(seen).toHaveLength(1);
    void respond;
  });
});
