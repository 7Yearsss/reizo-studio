import { describe, expect, it } from 'vitest';
import { classifyMediaError } from './mediaError';

describe('classifyMediaError', () => {
  it('flags a safety rejection as non-retryable and localises it', () => {
    const e = classifyMediaError(new Error('Your request was rejected as a result of our safety system. content_policy_violation'));
    expect(e.code).toBe('safety_rejection');
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('内容安全策略');
  });

  it('distinguishes an input-image rejection', () => {
    const e = classifyMediaError(new Error('The input image was blocked by our moderation system'));
    expect(e.code).toBe('safety_rejection');
    expect(e.subject).toBe('input_image');
    expect(e.message).toContain('输入图片');
  });

  it('treats 429 as retryable rate limiting', () => {
    const e = classifyMediaError({ statusCode: 429, message: 'Rate limit reached for images' });
    expect(e.code).toBe('rate_limited');
    expect(e.retryable).toBe(true);
  });

  it('quota exhaustion is non-retryable', () => {
    const e = classifyMediaError(new Error('You exceeded your current quota, please check your plan and billing'));
    expect(e.code).toBe('quota_exceeded');
    expect(e.retryable).toBe(false);
  });

  it('auth errors point at the account', () => {
    const e = classifyMediaError({ status: 401, message: 'Incorrect API key provided' });
    expect(e.code).toBe('auth');
    expect(e.subject).toBe('account');
  });

  it('network failures stay retryable', () => {
    const e = classifyMediaError(new Error('fetch failed: ECONNRESET'));
    expect(e.code).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('an unknown error is retryable-undefined, not retryable-false', () => {
    const e = classifyMediaError(new Error('weird provider hiccup'));
    expect(e.code).toBe('unknown');
    expect(e.retryable).toBeUndefined();
  });
});
