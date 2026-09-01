import { describe, expect, it } from 'vitest';
import { formatProviderError } from './providerError';

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
