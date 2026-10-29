import { describe, expect, it, vi } from 'vitest';
import { collectVideoEvidence, directVideoDocument, type VideoPage } from './videoReader';

function fixture(): VideoPage {
  return { metadata: vi.fn(async () => ({ title: 'Reference clip', duration: 152 })),
    sample: vi.fn(async time => ({ timestamp: time, jpeg: Buffer.from('jpeg fixture'), captions: [{ start: 1, end: 3, text: 'untrusted subtitle' }] })), close: vi.fn(async () => undefined) };
}
describe('video evidence collection', () => {
  it('embeds direct media as a video instead of triggering a browser download, escaping URL attributes', () => {
    const html = decodeURIComponent(directVideoDocument('https://example.com/a.mp4?q=" onerror="evil').split(',')[1]);
    expect(html).toContain('&quot; onerror=&quot;'); expect(html).not.toContain('src="https://example.com/a.mp4?q=" onerror=');
  });
  it('samples the beginning and ending and deduplicates subtitles without claiming audio was transcribed', async () => {
    const page = fixture(); const result = await collectVideoEvidence({ url: 'https://example.com/clip', frameCount: 3 }, page, new AbortController().signal);
    expect(result.frames.map(frame => frame.timestamp)).toEqual([0, 75.925, 151.85]);
    expect(result.captions).toHaveLength(1); expect(result.audio).toBe('captions-only'); expect(page.close).toHaveBeenCalledOnce();
  });
  it('cancellation closes the browser and discards incomplete evidence', async () => {
    const page = fixture(); const controller = new AbortController();
    page.sample = vi.fn(async time => { controller.abort(); return { timestamp: time, jpeg: Buffer.from('frame'), captions: [] }; });
    await expect(collectVideoEvidence({ url: 'https://example.com' }, page, controller.signal)).rejects.toThrow();
    expect(page.sample).toHaveBeenCalledOnce(); expect(page.close).toHaveBeenCalledOnce();
  });
  it('does not pass a stale or empty frame to the model and closes the page on decode failure', async () => {
    const page = fixture(); page.sample = vi.fn(async () => ({ timestamp: 99, jpeg: Buffer.alloc(0), captions: [] }));
    await expect(collectVideoEvidence({ url: 'https://example.com' }, page, new AbortController().signal)).rejects.toThrow('时间不符');
    expect(page.close).toHaveBeenCalledOnce();
  });
});
