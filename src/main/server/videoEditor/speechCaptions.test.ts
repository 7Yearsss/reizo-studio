import { expect, it, vi } from 'vitest';
import { correctSpeechCaptions, generateSpeechCaptions } from './speechCaptions';
import { CompositionPreviews } from './composition';
import type { VideoToolResult } from '../../../shared/videoEditor';

const input = { editSessionId: 'draft', itemId: 'clip', jobId: 'job', language: 'zh' };
const result = (value: unknown): VideoToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
function fixture(enabled = false) {
  let isEnabled = enabled;
  const caps = { enabled: true, pages: [{ start: 2200, end: 2800, words: [{ wordRef: 'stable.ref', text: '语音' }] }] };
  const call = vi.fn(async (name: string, args: Record<string, unknown>): Promise<VideoToolResult> => {
    if (name === 'read_project') return result({ timeline: { id: 't', fps: 30, items: [{ id: 'clip', kind: 'video', startFrame: 60, durationInFrames: 120 }] } });
    if (name === 'read_captions') return result(args.list ? { tracks: [] } : isEnabled ? caps : { enabled: false });
    if (name === 'edit_captions' && args.action === 'source_list') return result({ sourceMode: 'sources', sources: [{ itemId: 'clip' }] });
    if (name === 'edit_captions' && args.action === 'enable') isEnabled = true;
    if (name === 'view_timeline_frames') return { content: [{ type: 'image', mimeType: 'image/png', data: 'pixels' }] };
    return result({ ok: true });
  });
  const store = new CompositionPreviews('unused');
  const save = vi.spyOn(store, 'save').mockResolvedValue({ id: 'preview', editSessionId: 'draft', timelineId: 't', summary: '语音字幕', frames: [75], imageCount: 1, createdAt: 1 });
  return { call, store, save };
}
it('attaches the completed transcript before enabling exact-source captions and renders their timeline time', async () => {
  const { call, store, save } = fixture();
  const output = await generateSpeechCaptions(input, call, store, 'session');
  expect(call.mock.calls.filter(c => c[0] === 'reizo_speech_job')).toEqual([['reizo_speech_job', { editSessionId: 'draft', action: 'attach', itemId: 'clip', jobId: 'job', language: 'zh' }, undefined]]);
  expect(call).toHaveBeenCalledWith('view_timeline_frames', { editSessionId: 'draft', frames: [75] }, undefined);
  expect(save).toHaveBeenCalledOnce(); expect(output.content.some(c => c.type === 'image')).toBe(true);
});
it('stops before captions if recognition is empty or incomplete', async () => {
  const { call, store, save } = fixture(); const original = call.getMockImplementation();
  if (!original) throw new Error('Missing fixture implementation');
  call.mockImplementation((name, args) => name === 'reizo_speech_job' ? Promise.resolve(result({ error: '尚无有效语音' })) : original(name, args));
  await expect(generateSpeechCaptions(input, call, store, 's')).rejects.toThrow('有效语音');
  expect(call.mock.calls.some(c => c[0] === 'edit_captions')).toBe(false); expect(save).not.toHaveBeenCalled();
});
it('rejects unrelated and whole-timeline captions before mutation', async () => {
  for (const source of [{ sources: [{ itemId: 'other' }] }, { sourceMode: 'timeline', sourceItemId: 'clip' }]) {
    const { call, store } = fixture(true); const original = call.getMockImplementation();
    if (!original) throw new Error('Missing fixture implementation');
    call.mockImplementation((name, args) => name === 'edit_captions' ? Promise.resolve(result(source)) : original(name, args));
    await expect(generateSpeechCaptions(input, call, store, 's')).rejects.toThrow('其他来源');
    expect(call.mock.calls.some(c => c[0] === 'reizo_speech_job')).toBe(false);
  }
});
it('corrects display text only and preserves original transcript/timing', async () => {
  const { call, store } = fixture(true), corrections = [{ wordRef: 'stable.ref', text: '声音', forcePageBreak: true }];
  await correctSpeechCaptions({ ...input, corrections }, call, store, 's');
  expect(call.mock.calls.filter(c => c[0] === 'edit_captions' && c[1].action !== 'source_list').map(c => c[1])).toEqual([{ editSessionId: 'draft', action: 'display_text', json: JSON.stringify({ overrides: corrections }) }]);
  expect(call.mock.calls.some(c => ['reizo_speech_job', 'edit_item', 'manage_transcript'].includes(c[0]))).toBe(false);
});
it('rejects stale refs before any display edit', async () => {
  const { call, store } = fixture(true);
  await expect(correctSpeechCaptions({ ...input, corrections: [{ wordRef: 'stale', text: 'x' }] }, call, store, 's')).rejects.toThrow('引用过期');
  expect(call.mock.calls.some(c => c[1].action === 'display_text')).toBe(false);
});
