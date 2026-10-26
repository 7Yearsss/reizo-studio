import { describe, expect, it } from 'vitest';
import { memoryAgeDays, staleMemoryNote, STALE_MEMORY_DAYS } from './memoryAge';

const now = new Date('2026-10-27T00:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe('memory age', () => {
  it('counts whole days', () => {
    expect(memoryAgeDays(daysAgo(3), now)).toBe(3);
    expect(memoryAgeDays(undefined, now)).toBeNull();
    expect(memoryAgeDays('garbage', now)).toBeNull();
    expect(memoryAgeDays(new Date(now.getTime() + 1000).toISOString(), now)).toBe(0);
  });
  it('warns only past the threshold, naming the age', () => {
    expect(staleMemoryNote(daysAgo(STALE_MEMORY_DAYS), now)).toBe('');
    expect(staleMemoryNote(daysAgo(STALE_MEMORY_DAYS + 1), now)).toContain('61 天');
    expect(staleMemoryNote(daysAgo(200), now)).toContain('过时');
    expect(staleMemoryNote(undefined, now)).toBe('');
  });
});
