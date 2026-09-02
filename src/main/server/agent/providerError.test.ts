import { describe, expect, it } from 'vitest';
import { classifyProviderError, formatProviderError } from './providerError';

/** Shape logged from the v2api.top 524 that surfaced as `openai_error`. */
function apiCallError(input: {
  message: string;
  statusCode: number;
  isRetryable?: boolean;
  data?: unknown;
}): Error {
  return Object.assign(new Error(input.message), {
    name: 'AI_APICallError',
    statusCode: input.statusCode,
    isRetryable: input.isRetryable ?? true,
    data: input.data,
  });
}

describe('formatProviderError', () => {
  it('turns the gateway 524 / openai_error blob into a timeout the user can retry', () => {
    const error = apiCallError({
      message: 'openai_error',
      statusCode: 524,
      isRetryable: true,
      data: {
        error: {
          message: 'openai_error',
          type: 'bad_response_status_code',
          code: 'bad_response_status_code',
        },
      },
    });
    expect(formatProviderError(error)).toBe(
      '上游超时（HTTP 524）。网关在等待模型输出时断开了，可以重试。',
    );
  });

  it('does not pass a bare openai_error string through as the UI copy', () => {
    expect(formatProviderError('openai_error')).toBe('模型请求失败（openai_error）。');
  });

  it('keeps a readable SDK timeout message', () => {
    expect(formatProviderError(new Error('Step timeout of 120000ms exceeded'))).toBe(
      'Step timeout of 120000ms exceeded',
    );
  });
});

describe('classifyProviderError', () => {
  it('splits Anthropic 529 overloaded (SDK already retries) from OpenAI capacity', () => {
    const over = classifyProviderError({ statusCode: 529, message: 'Overloaded' });
    expect(over.kind).toBe('overloaded');
    expect(over.alreadyRetriedBySdk).toBe(true);

    const cap = classifyProviderError(new Error('Selected model is at capacity. Please try again.'));
    expect(cap.kind).toBe('capacity');
    expect(cap.alreadyRetriedBySdk).toBe(false);
    expect(cap.retryable).toBe(true);
  });

  it('auth errors are not retryable', () => {
    expect(classifyProviderError({ status: 401, message: 'invalid api key' }).retryable).toBe(false);
  });

  it('classifies a rate limit and a timeout', () => {
    expect(classifyProviderError({ statusCode: 429, message: 'rate limit' }).kind).toBe('rate_limited');
    expect(classifyProviderError(new Error('Step timeout of 120000ms exceeded')).kind).toBe('timeout');
  });
});
