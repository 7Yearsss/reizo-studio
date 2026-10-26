/**
 * The AI SDK retries failed provider calls on its own, silently. Watching the fetch underneath lets the user
 * see why a reply is slow ("重试 1/2") instead of staring at a spinner.
 */
export function retryNotice(attempt: number, maxRetries: number, reason: 'rate_limit' | 'unavailable' | 'network'): string | null {
  if (attempt < 1 || attempt > maxRetries) return null;
  const why = reason === 'rate_limit' ? '请求被限流' : reason === 'network' ? '网络不稳定' : '模型服务暂时不可用';
  return `${why}，正在重试 ${attempt}/${maxRetries}…`;
}

export function failureReason(status: number): 'rate_limit' | 'unavailable' | null {
  if (status === 429) return 'rate_limit';
  if (status >= 500 && status < 600) return 'unavailable';
  return null;
}

/** Wrap a fetch so each consecutive failed attempt is announced; a good response resets the count. */
export function observeRetries(
  base: typeof fetch,
  options: { maxRetries: number; announce: (text: string) => void },
): typeof fetch {
  let failures = 0;
  const note = (reason: 'rate_limit' | 'unavailable' | 'network') => {
    failures += 1;
    const text = retryNotice(failures, options.maxRetries, reason);
    if (text) options.announce(text);
  };
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try {
      const response = await base(input, init);
      const reason = failureReason(response.status);
      if (reason) note(reason);
      else failures = 0;
      return response;
    } catch (error) {
      // A user abort is not an upstream problem and is never retried.
      if (!(error instanceof Error && error.name === 'AbortError')) note('network');
      throw error;
    }
  }) as typeof fetch;
}
