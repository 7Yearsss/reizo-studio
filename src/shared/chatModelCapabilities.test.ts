import { describe, expect, it } from 'vitest';
import { chatModelCapabilities, contextWindowFor } from './chatModelCapabilities';

describe('chatModelCapabilities', () => {
  it('matches on the bare id, ignoring provider prefixes and case', () => {
    expect(chatModelCapabilities('openai/GPT-4o-mini')).toEqual({ contextWindow: 128_000, vision: true });
    expect(chatModelCapabilities('gemini-2.5-pro').reasoning).toBe(true);
  });

  it('specific rules beat general ones', () => {
    expect(chatModelCapabilities('moonshot-v1-32k').contextWindow).toBe(32_000);
    expect(chatModelCapabilities('glm-4.5v').vision).toBe(true);
    expect(chatModelCapabilities('glm-4.5').vision).toBe(false);
  });

  it('knows nothing about an unknown model instead of guessing', () => {
    expect(chatModelCapabilities('my-private-model')).toEqual({});
    expect(chatModelCapabilities('')).toEqual({});
  });

  it('user overrides win field by field and leave the rest to the table', () => {
    const merged = chatModelCapabilities('gpt-4o', { contextWindow: 32_000, vision: false });
    expect(merged).toEqual({ contextWindow: 32_000, vision: false });
    expect(chatModelCapabilities('o3-mini', { vision: true })).toEqual({ contextWindow: 200_000, reasoning: true, vision: true });
  });

  it('contextWindowFor falls back only when nothing is known', () => {
    expect(contextWindowFor('gpt-4.1', 128_000)).toBe(1_000_000);
    expect(contextWindowFor('mystery', 128_000)).toBe(128_000);
    expect(contextWindowFor('mystery', 128_000, { contextWindow: 16_000 })).toBe(16_000);
  });
});

describe('capabilityBadge', () => {
  it('shows only what is known', async () => {
    const { capabilityBadge } = await import('./chatModelCapabilities');
    expect(capabilityBadge('gemini-2.5-pro')).toBe('视觉 · 推理 · 1M');
    expect(capabilityBadge('gpt-4o')).toBe('视觉 · 128K');
    expect(capabilityBadge('mystery')).toBeUndefined();
  });
});
