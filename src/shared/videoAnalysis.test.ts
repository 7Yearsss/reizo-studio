import { describe, expect, it } from 'vitest';
import { bareVideoLink, VideoAnalysisInput, videoSampleTimes } from './videoAnalysis';

describe('video analysis input and sampling', () => {
  it('covers the full clip including its ending, and can revisit a narrow interval', () => {
    const times = videoSampleTimes(152, {});
    expect(times).toHaveLength(16); expect(times[0]).toBe(0); expect(times.at(-1)).toBe(151.85);
    expect(videoSampleTimes(152, { startSeconds: 125, endSeconds: 135, frameCount: 3 })).toEqual([125, 129.925, 134.85]);
  });
  it('rejects live streams, invalid ranges and excessive frame requests', () => {
    for (const duration of [Infinity, NaN, 0, -2]) expect(() => videoSampleTimes(duration, {})).toThrow();
    expect(() => videoSampleTimes(10, { startSeconds: 10 })).toThrow();
    expect(() => videoSampleTimes(10, { startSeconds: 5, endSeconds: 2 })).toThrow();
    expect(VideoAnalysisInput.safeParse({ url: 'https://example.com', frameCount: 25 }).success).toBe(false);
    expect(VideoAnalysisInput.safeParse({ url: 'https://example.com', startSeconds: 12, endSeconds: 8 }).success).toBe(false);
  });
  it('recognises bare video links without turning an ordinary link or question into a forced action', () => {
    const x = 'https://x.com/JTL19971224/status/2114907009460191405';
    expect(bareVideoLink(x)).toBe(x);
    expect(bareVideoLink('https://cdn.example.com/a.mp4?key=x')).toBeTruthy();
    for (const value of ['https://example.com', x + ' 这条帖子的作者是谁', 'https://x.com.evil.test/a', 'https://user:pw@x.com/u/status/123']) expect(bareVideoLink(value)).toBeUndefined();
  });
});
