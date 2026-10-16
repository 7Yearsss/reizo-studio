import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SourceInspections } from './sourceInspection';
import { buildComposition, CompositionPreviews } from './composition';
import type { VideoComposition } from '../../../shared/videoComposition';
import type { ShotSelections } from '../../../shared/videoSelection';
import type { VideoToolResult } from '../../../shared/videoEditor';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const project = { projectId: 'p', timeline: { fps: 30 }, mediaPool: { assets: [
  { id: 'old-selected', name: '原素材', kind: 'video', src: '/media/immutable-1.mp4', durationInFrames: 360 },
  { id: 'new-unselected', name: '新素材', kind: 'video', src: '/media/immutable-2.mp4', durationInFrames: 360 },
  { id: 'audio', name: '音频', kind: 'audio', src: '/media/audio.wav', durationInFrames: 360 },
] } };
const result = (value: unknown): VideoToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const image = { type: 'image', mimeType: 'image/jpeg', data: 'aW1hZ2U=' };
const plan: VideoComposition = { name: '主题粗剪', aspectRatio: '16:9', fit: 'contain', durationSeconds: 6, shots: [{ assetId: 'old-selected', sourceStartSeconds: 0, durationSeconds: 6, volume: 0 }], title: null, captions: [], captionSource: 'none', music: null };
const input = { editSessionId: 'draft', sources: [{ assetId: 'old-selected', fromSeconds: 0, toSeconds: 6 }] };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'source-inspection-')); roots.push(root);
  const store = new SourceInspections(root);
  const call = vi.fn(async (name: string, args: Record<string, unknown>): Promise<VideoToolResult> => name === 'read_project' ? result(project) : { content: [...result({ coordinateSpace: 'source', assetId: args.assetId, frames: args.frames, layout: 'contact_sheet' }).content, image] });
  return { root, store, call };
}
async function inspected() {
  const f = await fixture();
  const output = await f.store.inspect('chat', input, f.call);
  const info = JSON.parse(output.content[1].text ?? '{}');
  const selections: ShotSelections = [{ evidenceId: info.evidenceId, observedFrames: info.observedFrames, role: 'opening', reason: '画面主体清楚，适合作为开场' }];
  return { ...f, output, info, selections };
}

it('samples exact selected source windows, returns real images and persists scoped evidence', async () => {
  const f = await inspected();
  expect(f.call.mock.calls).toEqual([
    ['read_project', { editSessionId: 'draft' }, undefined],
    ['view_asset_frames', { editSessionId: 'draft', assetId: 'old-selected', frames: [15, 45, 75, 105, 135, 165] }, undefined],
  ]);
  expect(f.output.content).toContainEqual(image);
  const reopened = new SourceInspections(f.root);
  expect((await reopened.read('chat', f.info.evidenceId)).frames).toEqual([15, 45, 75, 105, 135, 165]);
  await expect(reopened.read('other-chat', f.info.evidenceId)).rejects.toThrow('当前对话');
  await expect(reopened.read('chat', '../latest')).rejects.toThrow('标识');
  const validate = await reopened.validator('chat', 'draft', plan, f.selections);
  expect(validate(project)).toContain('选段理由（AI 判断）');
  expect(validate(project)).toContain('0.50、1.50');
});

it('validates a whole batch before extraction and does not silently substitute sources', async () => {
  const f = await fixture();
  for (const sources of [[{ assetId: 'old' }], [{ assetId: 'old-selected' }, { assetId: 'audio' }], [{ assetId: 'old-selected', toSeconds: 13 }]]) {
    f.call.mockClear();
    await expect(f.store.inspect('chat', { editSessionId: 'draft', sources }, f.call)).rejects.toThrow();
    expect(f.call.mock.calls.map(c => c[0])).toEqual(['read_project']);
  }
});

it('never records absent, mismatched or fabricated frame evidence; honors abort', async () => {
  const f = await fixture();
  for (const frameResult of [result({ frames: [15] }), { content: [...result({ coordinateSpace: 'source', assetId: 'other', frames: [15] }).content, image] }, { content: [...result({ coordinateSpace: 'source', assetId: 'old-selected', frames: [999] }).content, image] }]) {
    f.call.mockResolvedValueOnce(result(project)).mockResolvedValueOnce(frameResult);
    await expect(f.store.inspect('chat', input, f.call)).rejects.toThrow('未返回可核对');
  }
  const controller = new AbortController(); controller.abort(); f.call.mockClear();
  await expect(f.store.inspect('chat', input, f.call, controller.signal)).rejects.toThrow();
  expect(f.call).not.toHaveBeenCalled();
});

it('rejects wrong draft/project, relinked versions and unobserved/out-of-range selection', async () => {
  const f = await inspected();
  const validate = await f.store.validator('chat', 'draft', plan, f.selections);
  expect(() => validate({ ...project, projectId: 'other' } as typeof project)).toThrow('不一致');
  expect(() => validate({ ...project, mediaPool: { assets: project.mediaPool.assets.map(a => ({ ...a, src: '/relinked.mp4' })) } })).toThrow('不一致');
  expect(() => validate({ ...project, timeline: { fps: 24 } })).toThrow('不一致');
  expect(await f.store.validator('chat', 'other-draft', plan, f.selections).then(fn => () => fn(project))).toThrow('不一致');
  const fabricated = await f.store.validator('chat', 'draft', plan, [{ ...f.selections[0], observedFrames: [16] }]);
  expect(() => fabricated(project)).toThrow('未实际返回');
  const outside = await f.store.validator('chat', 'draft', { ...plan, shots: [{ ...plan.shots[0], sourceStartSeconds: 1 }] }, f.selections);
  expect(() => outside(project)).toThrow('超出');
  await expect(f.store.validator('chat', 'draft', { ...plan, shots: [...plan.shots, ...plan.shots] }, f.selections)).rejects.toThrow('每个');
});

it('requires closer inspection when broad source samples leave a candidate poorly covered', async () => {
  const f = await inspected();
  const validate = await f.store.validator('chat', 'draft', plan, [{ ...f.selections[0], observedFrames: [15, 165] }]);
  expect(() => validate(project)).toThrow('抽样过疏');
});

it('supports static image holds without treating their nominal duration as moving footage', async () => {
  const f = await fixture();
  const still = { ...project, mediaPool: { assets: [{ id: 'photo', name: '照片', kind: 'image', src: '/media/photo.png', durationInFrames: 90 }] } };
  f.call.mockResolvedValueOnce(result(still));
  const output = await f.store.inspect('chat', { editSessionId: 'draft', sources: [{ assetId: 'photo' }] }, f.call);
  const entry = JSON.parse(output.content[1].text ?? '{}');
  expect(entry.observedFrames).toEqual([0]);
  const photoPlan = { ...plan, shots: [{ ...plan.shots[0], assetId: 'photo' }] };
  const validate = await f.store.validator('chat', 'draft', photoPlan, [{ evidenceId: entry.evidenceId, observedFrames: [0], reason: '静态留白', role: 'opening' }]);
  expect(validate(still)).toContain('静态留白');
});

it('checks evidence before timeline mutation and persists selection reasons with composite preview', async () => {
  const f = await inspected();
  const validate = await f.store.validator('chat', 'draft', plan, f.selections);
  const previews = new CompositionPreviews(f.root);
  let reads = 0;
  const call = vi.fn(async (name: string) => {
    if (name === 'get_edit_session') return result({ status: 'drafting' });
    if (name === 'read_project') return result(++reads === 1 ? project : { timeline: { id: 'new-timeline', items: [{ startFrame: 0, durationInFrames: 180 }] } });
    if (name === 'edit_item') return result({ results: [{ placed: { itemId: 'clip' } }] });
    if (name === 'view_timeline_frames') return { content: [image] };
    return result({ ok: true });
  });
  await expect(buildComposition(plan, 'draft', call, previews, 'chat', undefined, () => { throw new Error('stale evidence'); })).rejects.toThrow('stale evidence');
  expect(call.mock.calls.map(c => c[0])).toEqual(['get_edit_session', 'read_project']);
  reads = 0; call.mockClear();
  await buildComposition(plan, 'draft', call, previews, 'chat', undefined, validate);
  const preview = await new CompositionPreviews(f.root).latest('chat');
  expect(preview?.summary).toContain(f.selections[0].reason);
  expect(preview?.summary).toContain('未分析语音');
  expect(preview?.imageCount).toBe(1);
  expect(call.mock.calls.map(c => c[0])).not.toContain('review_edit_session');
});
