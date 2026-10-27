import { describe, expect, it } from 'vitest';
import { followScrollTop, isFollowing } from './turnAnchor';

describe('followScrollTop', () => {
  it('goes to the end when no question is anchored', () => {
    expect(followScrollTop({ scrollTop: 100, maxScroll: 900 })).toBe(900);
  });
  it('stops with the question at the top once the reply is long', () => {
    expect(followScrollTop({ scrollTop: 500, maxScroll: 5000, questionTop: 800 })).toBe(788);
  });
  it('behaves like follow-to-end while the reply is still short', () => {
    expect(followScrollTop({ scrollTop: 500, maxScroll: 600, questionTop: 800 })).toBe(600);
  });
  it('never scrolls up past where the reader already is', () => {
    expect(followScrollTop({ scrollTop: 2000, maxScroll: 5000, questionTop: 800 })).toBe(2000);
  });
});

describe('isFollowing', () => {
  it('is true at or below the line, false once scrolled clearly above it', () => {
    expect(isFollowing({ scrollTop: 788, followTo: 788, threshold: 80 })).toBe(true);
    expect(isFollowing({ scrollTop: 300, followTo: 788, threshold: 80 })).toBe(false);
  });
});
