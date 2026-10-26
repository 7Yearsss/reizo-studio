import { describe, expect, it } from 'vitest';
import { classifyTurnError, presentTurnError, turnErrorFromMessage, type TurnErrorKind } from './turnError';

const kind = (status: number | undefined, message = ''): TurnErrorKind => classifyTurnError({ status, message });

describe('classifyTurnError', () => {
  it('a 403 from a region block is NOT told to check the key', () => {
    expect(kind(403, 'unsupported_country_region_territory')).toBe('region_blocked');
    expect(kind(403, 'Country, region, or territory not supported')).toBe('region_blocked');
    const shown = presentTurnError({ status: 403, message: 'unsupported_country_region_territory' });
    expect(shown.hint).toContain('不是密钥');
    expect(shown.title).not.toContain('密钥');
  });

  it('separates 401, plain 403, 402 and balance wording', () => {
    expect(kind(401, 'Incorrect API key provided')).toBe('auth');
    expect(kind(403, 'forbidden')).toBe('forbidden');
    expect(kind(402)).toBe('quota');
    expect(kind(429, 'You exceeded your current quota, please check your plan and billing details')).toBe('quota');
    expect(kind(undefined, '账户余额不足')).toBe('quota');
  });

  it('429 is a rate limit, not a balance problem', () => {
    expect(kind(429, 'Rate limit reached for requests')).toBe('rate_limited');
    expect(presentTurnError({ status: 429 }).hint).toContain('不是余额');
  });

  it('recognises missing models, oversized contexts and requests, and content filters', () => {
    expect(kind(404, 'The model `gpt-9` does not exist')).toBe('model_not_found');
    expect(kind(400, "This model's maximum context length is 128000 tokens")).toBe('context_too_long');
    expect(kind(400, 'prompt is too long: 250000 tokens')).toBe('context_too_long');
    expect(kind(413)).toBe('payload_too_large');
    expect(kind(400, 'Your request was rejected as a result of our safety system')).toBe('content_filtered');
    expect(kind(400, 'content_filter triggered')).toBe('content_filtered');
  });

  it('keeps the transient kinds', () => {
    expect(kind(529)).toBe('overloaded');
    expect(kind(undefined, 'The selected model is at capacity')).toBe('capacity');
    expect(kind(524)).toBe('timeout');
    expect(kind(503)).toBe('upstream');
    expect(kind(undefined, 'fetch failed')).toBe('network');
    expect(kind(undefined, 'something odd')).toBe('unknown');
  });
});

describe('presentTurnError', () => {
  it('gives every kind a Chinese title, a hint and exactly one action', () => {
    const kinds: TurnErrorKind[] = ['region_blocked', 'auth', 'quota', 'forbidden', 'rate_limited', 'model_not_found', 'content_filtered', 'context_too_long', 'payload_too_large', 'timeout', 'capacity', 'overloaded', 'upstream', 'network', 'unknown'];
    for (const k of kinds) {
      const sample = { region_blocked: [403, 'unsupported_country'], auth: [401, ''], quota: [402, ''], forbidden: [403, ''], rate_limited: [429, ''], model_not_found: [404, ''], content_filtered: [400, 'content_filter'], context_too_long: [400, 'context length'], payload_too_large: [413, ''], timeout: [524, ''], capacity: [undefined, 'at capacity'], overloaded: [529, ''], upstream: [500, ''], network: [undefined, 'fetch failed'], unknown: [undefined, ''] }[k] as [number | undefined, string];
      const shown = presentTurnError({ status: sample[0], message: sample[1] });
      expect(shown.kind, k).toBe(k);
      expect(/[一-鿿]/.test(shown.title), `${k} title`).toBe(true);
      expect(shown.hint.length, `${k} hint`).toBeGreaterThan(5);
      expect(shown.action).toBeTruthy();
    }
  });
  it('context-too-long points at compaction; auth at the provider settings', () => {
    expect(presentTurnError({ status: 400, message: 'maximum context length' }).action).toBe('compact_session');
    expect(presentTurnError({ status: 401 }).action).toBe('open_providers');
  });
});

describe('turnErrorFromMessage', () => {
  it('recovers the presentation from a message the app itself produced', () => {
    const region = presentTurnError({ status: 403, message: 'unsupported_country_region_territory' });
    const text = `${region.title}（HTTP 403）。${region.hint}`;
    expect(turnErrorFromMessage(text)?.kind).toBe('region_blocked');
    expect(turnErrorFromMessage('随便一段别的报错')).toBeNull();
    expect(turnErrorFromMessage(undefined)).toBeNull();
  });
});
