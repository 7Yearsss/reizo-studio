import { expect, it, vi } from 'vitest';
import { compileRefinement, refineDraft, type RefinementTimeline } from './refinement';
import { CompositionPreviews } from './composition';
import type { VideoToolResult } from '../../../shared/videoEditor';

const timeline: RefinementTimeline = { id: 'timeline', name: 'Test', fps: 30, items: [
  { id: 'a', name: 'A', kind: 'video', track: 'v1', startFrame: 0, durationInFrames: 300 },
  { id: 'b', name: 'B', kind: 'video', track: 'v1', startFrame: 300, durationInFrames: 300 },
  { id: 'c', name: 'A again', kind: 'video', track: 'v1', startFrame: 600, durationInFrames: 300 },
  { id: 'title', name: '标题', kind: 'text', track: 'v3', startFrame: 0, durationInFrames: 120, props: { text: '标题', fontSize: 192, color: 'white' } },
  { id: 'caption', name: '字幕', kind: 'text', track: 'v2', startFrame: 630, durationInFrames: 210 },
  { id: 'music', name: 'BGM', kind: 'audio', track: 'a1', startFrame: 0, durationInFrames: 900, volume: 0.2, fadeInFrames: 30, fadeOutFrames: 30 },
] };
const shorten = [{ action: 'shorten_shot', itemId: 'b', seconds: 2 }];
const result = (value: unknown): VideoToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

it('changes only requested title properties and volume without replacing any media', () => {
  const original = structuredClone(timeline);
  const compiled = compileRefinement([{ action: 'text', itemId: 'title', fontSizeScale: 0.8 }, { action: 'volume', itemId: 'music', volume: 0.1 }], timeline);
  expect(compiled.updates).toEqual([{ type: 'text', itemId: 'title', props: { fontSize: 153.6 } }, { type: 'audio', itemId: 'music', volume: 0.1 }]);
  expect(compiled.deletes).toEqual([]); expect(compiled.durationInFrames).toBe(900);
  expect(timeline).toEqual(original);
});

it('closes the shortened tail across later shots, captions and continuous background music', () => {
  const compiled = compileRefinement(shorten, timeline);
  expect(compiled.updates).toEqual([
    { type: 'video', itemId: 'b', durationInFrames: 240 },
    { type: 'video', itemId: 'c', startFrame: 540 },
    { type: 'text', itemId: 'caption', startFrame: 570 },
    { type: 'audio', itemId: 'music', durationInFrames: 840 },
  ]);
  expect(compiled.durationInFrames).toBe(840);
  expect(compiled.summary).toContain('30 → 28');
  expect(compiled.updates.every(u => !('srcInFrame' in u) && !('assetId' in u))).toBe(true);
});

it('clamps text crossing the removed interval and explicitly reports fully removed text', () => {
  const test = structuredClone(timeline);
  test.items.push({ id: 'overlap', name: '跨界字幕', kind: 'text', track: 'v2', startFrame: 520, durationInFrames: 100 });
  test.items.push({ id: 'inside', name: '删除字幕', kind: 'text', track: 'v2', startFrame: 550, durationInFrames: 20 });
  const compiled = compileRefinement(shorten, test);
  expect(compiled.updates).toContainEqual({ type: 'text', itemId: 'overlap', durationInFrames: 40 });
  expect(compiled.deletes).toEqual([{ type: 'text', itemId: 'inside' }]);
  expect(compiled.summary).toContain('删除字幕');
});

it('rejects ambiguous identity, disappearing shots and unsafe timing dependencies', () => {
  expect(() => compileRefinement([{ action: 'volume', itemId: 'mus', volume: 0.1 }], timeline)).toThrow('完整');
  expect(() => compileRefinement([{ ...shorten[0], seconds: 10 }], timeline)).toThrow('至少');
  expect(() => compileRefinement(shorten, { ...timeline, transitions: [{}] })).toThrow('转场');
  const audio = structuredClone(timeline); audio.items[5].startFrame = 500;
  expect(() => compileRefinement(shorten, audio)).toThrow('局部音频');
  const locked = { ...timeline, tracks: [{ id: 'a1', locked: true }] };
  expect(() => compileRefinement(shorten, locked)).toThrow('锁定');
  const animated = structuredClone(timeline); animated.items[2].keyframes = { opacity: [{}] };
  expect(() => compileRefinement(shorten, animated)).toThrow('关键帧');
  const fast = structuredClone(timeline); fast.items[1].sourceDurationInFrames = 600;
  expect(() => compileRefinement(shorten, fast)).toThrow('变速');
});

it('refuses a pending review without discarding it or mutating the live project', async () => {
  const call = vi.fn(async () => result({ status: 'awaiting_review' }));
  await expect(refineDraft(shorten, 'draft', call, new CompositionPreviews('unused'), 's')).rejects.toThrow('resume_edit_session');
  expect(call).toHaveBeenCalledTimes(1);
});

it('publishes exactly one atomic batch, fresh preview and no automatic review', async () => {
  const after = structuredClone(timeline); after.items[1].durationInFrames = 240; after.items[2].startFrame = 540; after.items[4].startFrame = 570; after.items[5].durationInFrames = 840;
  let reads = 0;
  const call = vi.fn(async (name: string) => name === 'get_edit_session' ? result({ status: 'drafting' }) : name === 'read_project' ? result({ timeline: ++reads === 1 ? timeline : after }) : name === 'view_timeline_frames' ? { content: [{ type: 'image', data: 'test', mimeType: 'image/png' }] } : result({ ok: true }));
  const previews = new CompositionPreviews('unused');
  const save = vi.spyOn(previews, 'save').mockResolvedValue({ id: 'p', editSessionId: 'draft', timelineId: 'timeline', summary: 'change', frames: [539], createdAt: 1, imageCount: 1 });
  await refineDraft(shorten, 'draft', call, previews, 's');
  expect(call.mock.calls.map(c => c[0])).toEqual(['get_edit_session', 'read_project', 'edit_item', 'read_project', 'view_timeline_frames']);
  expect(save.mock.calls[0][1]).not.toHaveProperty('plan');
  expect(save.mock.calls[0][1].summary).toContain('30 → 28');
});

it('does not render or publish a new preview after an atomic edit rejection', async () => {
  const call = vi.fn(async (name: string) => result(name === 'get_edit_session' ? { status: 'drafting' } : name === 'read_project' ? { timeline } : { ok: false, error: 'locked' }));
  const previews = new CompositionPreviews('unused'); const save = vi.spyOn(previews, 'save');
  await expect(refineDraft(shorten, 'draft', call, previews, 's')).rejects.toThrow('locked');
  expect(save).not.toHaveBeenCalled(); expect(call).toHaveBeenCalledTimes(3);
});
