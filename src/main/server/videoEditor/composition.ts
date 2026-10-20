import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { videoCompositionSchema, type VideoComposition, type CompositionPreview } from '../../../shared/videoComposition';
import type { VideoToolResult } from '../../../shared/videoEditor';
import { editorResult } from './mcpClient';

interface PoolAsset { id: string; name: string; kind: string; durationInFrames: number; offline?: boolean; src?: string | null }
export interface CompositionProject { timeline: { fps: number }; mediaPool: { assets: PoolAsset[] } }
export interface CompiledComposition {
  plan: VideoComposition; fps: number; durationInFrames: number; width: number; height: number;
  adds: Record<string, unknown>[]; decorations: Record<string, unknown>[]; frames: number[]; summary: string;
}
const dimensions = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440] } as const;

/** Compile exact source windows; no guessing, stretching or silent media replacement. */
export function compileComposition(input: unknown, project: CompositionProject): CompiledComposition {
  const plan = videoCompositionSchema.parse(input);
  const fps = project.timeline.fps;
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('工程帧率无效');
  const durationInFrames = Math.round(plan.durationSeconds * fps);
  if (durationInFrames < 1) throw new Error('成片时长不足一帧');
  const [width, height] = dimensions[plan.aspectRatio];
  const adds: Record<string, unknown>[] = [], decorations: Record<string, unknown>[] = [], frames: number[] = [];
  const names: string[] = [];
  function source(id: string, start: number, length: number, kinds: string[]) {
    const asset = project.mediaPool.assets.find((a) => a.id === id);
    if (!asset || !kinds.includes(asset.kind)) throw new Error(`素材 ${id} 不存在或类型不符；请使用完整的素材 ID`);
    if (asset.offline || !asset.src) throw new Error(`素材「${asset.name}」离线，请先重新关联`);
    const sourceStartFrame = Math.round(start * fps);
    if (asset.kind !== 'image' && (!Number.isFinite(asset.durationInFrames) || asset.durationInFrames <= 0 || sourceStartFrame + length > asset.durationInFrames)) throw new Error(`素材「${asset.name}」时长不足或未知，不能使用 ${start} 秒起的 ${length / fps} 秒片段`);
    if (asset.kind === 'image' && sourceStartFrame !== 0) throw new Error('静态图片的源起点必须为 0');
    return { asset, sourceStartFrame };
  }
  let cursor = 0;
  for (const shot of plan.shots) {
    const length = Math.round(shot.durationSeconds * fps);
    if (length < 1) throw new Error('每个镜头至少需要一帧');
    const { asset, sourceStartFrame } = source(shot.assetId, shot.sourceStartSeconds, length, ['video', 'image']);
    adds.push({ type: asset.kind, assetId: asset.id, track: 'V1', fromFrame: cursor,
      ...(asset.kind === 'image' ? { durationInFrames: length } : { sourceStartFrame, sourceDurationInFrames: length }) });
    decorations.push(asset.kind === 'video' ? { volume: shot.volume } : {});
    frames.push(cursor + Math.floor(length / 2));
    names.push(`${names.length + 1}. ${asset.name}：源 ${sourceStartFrame / fps}–${(sourceStartFrame + length) / fps} 秒 → 成片 ${cursor / fps}–${(cursor + length) / fps} 秒`);
    cursor += length;
  }
  if (cursor !== durationInFrames) throw new Error(`镜头总长 ${cursor / fps} 秒与目标 ${durationInFrames / fps} 秒不一致；请明确调整镜头时长`);
  function text(entry: NonNullable<VideoComposition['title']>, role: 'title' | 'caption') {
    const start = Math.round(entry.startSeconds * fps), end = Math.round(entry.endSeconds * fps);
    if (end <= start || end > durationInFrames) throw new Error('标题/字幕时间必须位于成片范围内，且结束晚于开始');
    const displaySize = Math.round(Math.min(width * (role === 'title' ? 0.1 : 0.08), height * (role === 'title' ? 0.065 : 0.045)));
    // OpenChatCut authors text in a 1920x1080 box, even in vertical timelines.
    // Compensate for that box's fit scale, or vertical text is much too small.
    const scale = plan.fit === 'cover' ? Math.max(width / 1920, height / 1080) : Math.min(width / 1920, height / 1080);
    const fontSize = displaySize / scale;
    const maxUnits = width * 0.8 / displaySize;
    const lines: string[] = []; let line = '', units = 0;
    for (const char of entry.text) {
      const size = char.charCodeAt(0) <= 127 ? 0.55 : 1;
      if (char === '\n' || units + size > maxUnits) { lines.push(line.trim()); line = ''; units = 0; }
      if (char !== '\n') { line += char; units += size; }
    }
    if (line.trim()) lines.push(line.trim());
    if (lines.length > (role === 'title' ? 3 : 2)) throw new Error(`${role === 'title' ? '标题' : '字幕'}过长，请缩短或拆成多条定时字幕，避免文字超出安全区`);
    // Authored text clips remain individually editable and share preview/export rendering.
    adds.push({ type: 'text', text: lines.join('\n'), name: role === 'title' ? '标题' : '字幕', track: role === 'title' ? 'V3' : 'V2', fromFrame: start, durationInFrames: end - start, fontSize, color: '#ffffff', fontWeight: role === 'title' ? 700 : 600, align: 'center' });
    decorations.push({ transform: { y: role === 'title' ? -34 : 34 } });
    frames.push(start + Math.floor((end - start) / 2));
  }
  if (plan.title) text(plan.title, 'title');
  if (plan.captions.length && plan.captionSource === 'none') throw new Error('字幕需要说明来源；不得把编写的文案冒充语音识别结果');
  let captionEnd = 0;
  for (const caption of plan.captions) {
    if (Math.round(caption.startSeconds * fps) < captionEnd) throw new Error('字幕时间不能重叠或倒序');
    text(caption, 'caption'); captionEnd = Math.round(caption.endSeconds * fps);
  }
  if (plan.music) {
    const { asset, sourceStartFrame } = source(plan.music.assetId, plan.music.sourceStartSeconds, durationInFrames, ['audio']);
    adds.push({ type: 'audio', assetId: asset.id, track: 'A1', fromFrame: 0, sourceStartFrame, sourceDurationInFrames: durationInFrames });
    const fade = Math.min(plan.music.fadeSeconds, durationInFrames / fps / 2);
    decorations.push({ volume: plan.music.volume, fadeInSeconds: fade, fadeOutSeconds: fade });
  }
  const unique = [...new Set(frames)].sort((a, b) => a - b);
  const sampled = unique.length <= 6 ? unique : Array.from({ length: 6 }, (_, i) => unique[Math.round(i * (unique.length - 1) / 5)]);
  const summary = [`${plan.name} · ${durationInFrames / fps} 秒 · ${plan.aspectRatio} · ${plan.fit === 'cover' ? '填满裁切' : '完整画面'}`,
    ...names, `标题：${plan.title?.text ?? '无'}；字幕 ${plan.captions.length} 条（${({ 'user-provided': '用户提供', 'verified-transcript': '已核对转录', 'authored-copy': '创作文案', none: '无' })[plan.captionSource]}）；配乐：${plan.music ? '指定素材，音量 ' + Math.round(plan.music.volume * 100) + '%' : '无'}`,
    '新建独立序列；应用后可撤销。'].join('\n');
  return { plan, fps, durationInFrames, width, height, adds, decorations, frames: sampled, summary };
}

type Call = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<VideoToolResult>;
export class CompositionPreviews {
  constructor(private root: string) {}
  private directory(sessionId: string) { return path.join(this.root, 'video-editor-previews', createHash('sha256').update(sessionId).digest('hex')); }
  async latest(sessionId: string): Promise<CompositionPreview | null> {
    try { return JSON.parse(await readFile(path.join(this.directory(sessionId), 'latest.json'), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async image(sessionId: string, id: string, index: number) {
    const latest = await this.latest(sessionId);
    if (!latest || latest.id !== id || !Number.isInteger(index) || index < 0 || index >= latest.imageCount) throw new Error('草稿预览不存在或已更新');
    return JSON.parse(await readFile(path.join(this.directory(sessionId), `${latest.id}-${index}.json`), 'utf8')) as { data: string; mimeType: string };
  }
  async save(sessionId: string, preview: Omit<CompositionPreview, 'id' | 'createdAt' | 'imageCount'>, result: VideoToolResult) {
    const images = result.content.filter((part) => part.type === 'image' && part.data && ['image/png', 'image/jpeg', 'image/webp'].includes(part.mimeType || ''));
    if (!images.length) throw new Error('关键帧未返回图片，草稿仍未提交审核');
    const id = randomUUID(), dir = this.directory(sessionId);
    await mkdir(dir, { recursive: true });
    for (const [index, img] of images.entries()) await writeFile(path.join(dir, `${id}-${index}.json`), JSON.stringify({ data: img.data, mimeType: img.mimeType }));
    const value: CompositionPreview = { ...preview, id, createdAt: Date.now(), imageCount: images.length };
    const temporary = path.join(dir, `${id}.tmp`);
    await writeFile(temporary, JSON.stringify(value)); await rename(temporary, path.join(dir, 'latest.json'));
    return value;
  }
}

/** All mutations remain in the caller's manual draft. A failure never submits review. */
export async function buildComposition(input: unknown, editSessionId: string, call: Call, previews: CompositionPreviews, sessionId: string, signal?: AbortSignal, validate?: (project: CompositionProject) => string): Promise<VideoToolResult> {
  const invoke = async (name: string, args: Record<string, unknown> = {}) => {
    signal?.throwIfAborted();
    const value = editorResult(await call(name, { ...args, editSessionId }, signal));
    if (value.error || value.ok === false) throw new Error(`${name}: ${String(value.error || '操作失败')}`);
    return value;
  };
  const status = await invoke('get_edit_session');
  if (status.status !== 'drafting') throw new Error('需要 drafting 状态的草稿；继续修改待审核方案时先明确取消旧草稿，再创建新草稿');
  const project = await invoke('read_project') as unknown as CompositionProject;
  const compiled = compileComposition(input, project);
  if (validate) compiled.summary += `\n\n${validate(project)}`;
  await invoke('manage_timelines', { action: 'create', name: compiled.plan.name, width: compiled.width, height: compiled.height });
  await invoke('edit_track', { action: 'create', json: JSON.stringify({ trackType: 'video', count: 2 }) });
  if (compiled.plan.music) await invoke('edit_track', { action: 'create', json: JSON.stringify({ trackType: 'audio' }) });
  await invoke('manage_timelines', { action: 'update', fit: compiled.plan.fit });
  const added = await invoke('edit_item', { adds: compiled.adds });
  const results = added.results as Array<{ placed?: { itemId?: string } }>;
  if (!Array.isArray(results) || results.length !== compiled.adds.length || results.some((result) => !result.placed?.itemId)) throw new Error('剪辑片段回执不完整，请检查草稿，勿重复提交');
  const updates = results.flatMap((result, i) => Object.keys(compiled.decorations[i]).length ? [{ type: compiled.adds[i].type, itemId: result.placed?.itemId, ...compiled.decorations[i] }] : []);
  if (updates.length) await invoke('edit_item', { updates });
  const after = await invoke('read_project');
  const timeline = after.timeline as { id: string; items: Array<{ startFrame: number; durationInFrames: number }> };
  if (Math.max(...timeline.items.map((item) => item.startFrame + item.durationInFrames)) !== compiled.durationInFrames) throw new Error('实际时间轴时长与计划不符，已保留草稿供检查');
  const rendered = await call('view_timeline_frames', { editSessionId, frames: compiled.frames }, signal);
  if (rendered.isError) throw new Error(rendered.content.find((part) => part.text)?.text || '关键帧渲染失败');
  const preview = await previews.save(sessionId, { editSessionId, timelineId: timeline.id, summary: compiled.summary, plan: compiled.plan, frames: compiled.frames }, rendered);
  // The model sees the actual rendered contact sheet before it decides to review.
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'drafting', preview, next: 'Inspect these actual rendered frames. If correct, call the top-level video_editor_review with editSessionId and the summary; no schema lookup or duplicate frame rendering is needed. If not, refine the draft and inspect its new preview before review. Nothing has been applied.' }) }, ...rendered.content.filter((part) => part.type === 'image')] };
}
