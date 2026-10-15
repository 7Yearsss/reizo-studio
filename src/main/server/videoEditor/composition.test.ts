import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildComposition, compileComposition, CompositionPreviews, type CompositionProject } from './composition';
import type { VideoComposition } from '../../../shared/videoComposition';
import type { VideoToolResult } from '../../../shared/videoEditor';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const project: CompositionProject = { timeline: { fps: 30 }, mediaPool: { assets: [
  { id: 'video-v1', name: '选中的旧版本', kind: 'video', durationInFrames: 600, src: '/media/v1.mp4' },
  { id: 'video-v2', name: '新版本', kind: 'video', durationInFrames: 600, src: '/media/v2.mp4' },
  { id: 'photo', name: '图片', kind: 'image', durationInFrames: 90, src: '/media/p.png' },
  { id: 'music', name: '音乐', kind: 'audio', durationInFrames: 1800, src: '/media/m.wav' },
] } };
const plan: VideoComposition = { name: '30秒竖屏', aspectRatio: '9:16', fit: 'contain', durationSeconds: 30,
  shots: [{ assetId: 'video-v1', sourceStartSeconds: 5, durationSeconds: 10, volume: 0.8 }, { assetId: 'photo', sourceStartSeconds: 0, durationSeconds: 20, volume: 0 }],
  title: { text: '标题', startSeconds: 0, endSeconds: 3 }, captions: [{ text: '指定字幕', startSeconds: 2, endSeconds: 4 }], captionSource: 'user-provided',
  music: { assetId: 'music', sourceStartSeconds: 2, volume: 0.2, fadeSeconds: 1 },
};
const result = (value: unknown): VideoToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

it('preserves exact versions and source windows, packs shots and separates title, subtitles and music', () => {
  const c = compileComposition(plan, project);
  expect(c.durationInFrames).toBe(900); expect([c.width, c.height]).toEqual([1080, 1920]);
  expect(c.adds[0]).toMatchObject({ assetId: 'video-v1', fromFrame: 0, sourceStartFrame: 150, sourceDurationInFrames: 300 });
  expect(c.adds[1]).toMatchObject({ assetId: 'photo', fromFrame: 300, durationInFrames: 600 });
  expect(c.adds[2]).toMatchObject({ track: 'V3', text: '标题', durationInFrames: 90 });
  expect(c.adds[3]).toMatchObject({ track: 'V2', text: '指定字幕', fromFrame: 60, durationInFrames: 60 });
  expect(c.adds[4]).toMatchObject({ type: 'audio', sourceStartFrame: 60, sourceDurationInFrames: 900 });
  expect(c.decorations[4]).toMatchObject({ volume: 0.2, fadeInSeconds: 1, fadeOutSeconds: 1 });
  expect(Number(c.adds[3].fontSize) * (1080 / 1920)).toBeGreaterThanOrEqual(86);
  const cover = compileComposition({ ...plan, fit: 'cover' }, project);
  expect(Number(cover.adds[3].fontSize) * (1920 / 1080)).toBeGreaterThanOrEqual(86);
});

it('rejects out-of-bounds source windows, ambiguous IDs, offline media, mismatched length and overlapping subtitles', () => {
  expect(() => compileComposition({ ...plan, shots: [{ ...plan.shots[0], sourceStartSeconds: 19 }, plan.shots[1]] }, project)).toThrow('时长不足');
  expect(() => compileComposition({ ...plan, shots: [{ ...plan.shots[0], assetId: 'video' }, plan.shots[1]] }, project)).toThrow('完整');
  expect(() => compileComposition(plan, { ...project, mediaPool: { assets: project.mediaPool.assets.map(a => ({ ...a, offline: true })) } })).toThrow('离线');
  expect(() => compileComposition({ ...plan, durationSeconds: 29 }, project)).toThrow('总长');
  expect(() => compileComposition({ ...plan, captions: [...plan.captions, { text: '重叠', startSeconds: 3, endSeconds: 6 }] }, project)).toThrow('重叠');
  expect(() => compileComposition({ ...plan, captionSource: 'none' }, project)).toThrow('来源');
  expect(() => compileComposition({ ...plan, title: { text: '超范围', startSeconds: 29, endSeconds: 31 } }, project)).toThrow('成片范围');
  expect(() => compileComposition({ ...plan, captions: [{ text: '长字幕'.repeat(25), startSeconds: 1, endSeconds: 2 }] }, project)).toThrow('安全区');
});

it('rejects invalid composition before any mutations and preserves a pending review', async () => {
  const store = new CompositionPreviews('unused');
  const call = vi.fn(async (name: string) => result(name === 'get_edit_session' ? { status: 'drafting' } : project));
  await expect(buildComposition({ ...plan, durationSeconds: 1 }, 'd1', call, store, 's')).rejects.toThrow('总长');
  expect(call.mock.calls.map(c => c[0])).toEqual(['get_edit_session', 'read_project']);
  call.mockClear(); call.mockResolvedValue(result({ status: 'awaiting_review' }));
  await expect(buildComposition(plan, 'd1', call, store, 's')).rejects.toThrow('drafting');
  expect(call).toHaveBeenCalledTimes(1);
});

it('does not submit review or publish a preview after a failed batch or missing rendered evidence', async () => {
  const store = new CompositionPreviews('unused'); const save = vi.spyOn(store, 'save');
  const names: string[] = [];
  const call = async (name: string) => { names.push(name); return result(name === 'get_edit_session' ? { status: 'drafting' } : name === 'read_project' ? project : name === 'edit_item' ? { ok: false, error: 'invalid clip' } : { ok: true }); };
  await expect(buildComposition(plan, 'draft', call, store, 's')).rejects.toThrow('invalid clip');
  expect(names).not.toContain('review_edit_session'); expect(save).not.toHaveBeenCalled();
  await expect(store.save('s', { editSessionId: 'd', timelineId: 't', summary: '', plan, frames: [0] }, result({ ok: true }))).rejects.toThrow('未返回图片');
});

it('persists preview and exact plan across restarts and isolates image access by conversation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'composition-')); roots.push(root);
  const store = new CompositionPreviews(root);
  const preview = await store.save('a', { editSessionId: 'draft', timelineId: 'timeline', summary: '摘要', plan, frames: [45] }, { content: [{ type: 'image', mimeType: 'image/png', data: 'cHJldmlldw==' }] });
  const reopened = new CompositionPreviews(root);
  expect(await reopened.latest('a')).toEqual(preview);
  expect(await reopened.latest('b')).toBeNull();
  await expect(reopened.image('b', preview.id, 0)).rejects.toThrow('不存在');
  await expect(reopened.image('a', '../latest', 0)).rejects.toThrow('不存在');
  await expect(reopened.image('a', preview.id, -1)).rejects.toThrow('不存在');
  expect((await reopened.image('a', preview.id, 0)).data).toBe('cHJldmlldw==');
});
