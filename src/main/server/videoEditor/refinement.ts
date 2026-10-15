import { videoRefinementSchema } from '../../../shared/videoRefinement';
import type { VideoToolResult } from '../../../shared/videoEditor';
import { CompositionPreviews } from './composition';
import { editorResult } from './mcpClient';

interface Item {
  id: string; kind: string; name: string; track: string; startFrame: number; durationInFrames: number;
  props?: Record<string, unknown>; volume?: number; fadeInFrames?: number; fadeOutFrames?: number;
  keyframes?: Record<string, unknown[]>; speed?: number; playbackRate?: number; hasTranscript?: boolean;
  sourceDurationInFrames?: number; trackId?: string;
}
export interface RefinementTimeline { id: string; name: string; fps: number; items: Item[]; transitions?: unknown[]; tracks?: Array<{ id: string; locked?: boolean; trackType?: string }> }

/** Compile a single atomic edit batch; unspecified fields and source identities never enter it. */
export function compileRefinement(input: unknown, timeline: RefinementTimeline) {
  const changes = videoRefinementSchema.parse(input);
  if (!Number.isFinite(timeline.fps) || timeline.fps <= 0) throw new Error('工程帧率无效');
  if (changes.filter(c => c.action === 'shorten_shot').length > 1) throw new Error('每轮先调整一个镜头的时长并检查结果');
  const updates = new Map<string, Record<string, unknown>>(), deletes: Record<string, unknown>[] = [];
  const summary: string[] = [], frames = new Set<number>();
  const duration = Math.max(0, ...timeline.items.map(i => i.startFrame + i.durationInFrames));
  let finalDuration = duration;
  const itemById = (id: string) => {
    const item = timeline.items.find(i => i.id === id);
    if (!item) throw new Error(`片段 ${id} 不存在，请读取草稿并使用完整片段 ID`);
    if (timeline.tracks?.some(t => t.id === (item.trackId ?? item.track) && t.locked)) throw new Error(`「${item.name}」所在轨道已锁定`);
    return item;
  };
  const patch = (item: Item, value: Record<string, unknown>) => updates.set(item.id, { type: item.kind, itemId: item.id, ...updates.get(item.id), ...value });
  for (const change of changes) {
    const item = itemById(change.itemId);
    frames.add(item.startFrame + Math.floor(item.durationInFrames / 2));
    if (change.action === 'text') {
      if (item.kind !== 'text') throw new Error('文字修改仅适用于文字片段');
      if (change.text === undefined && change.fontSizeScale === undefined) throw new Error('请指定文字或字号比例');
      const props = { ...(updates.get(item.id)?.props as Record<string, unknown> ?? {}) };
      if (change.text !== undefined) props.text = change.text;
      if (change.fontSizeScale !== undefined) {
        const current = Number(props.fontSize ?? item.props?.fontSize);
        if (!Number.isFinite(current) || current <= 0) throw new Error('当前字号未知，请先读取文字属性');
        props.fontSize = Math.round(current * change.fontSizeScale * 100) / 100;
      }
      patch(item, { props });
      summary.push(`「${item.name}」${change.text !== undefined ? `文字改为“${change.text}”` : ''}${change.fontSizeScale !== undefined ? ` 字号调整为原来的 ${Math.round(change.fontSizeScale * 100)}%` : ''}`);
    } else if (change.action === 'volume') {
      if (!['audio', 'video'].includes(item.kind)) throw new Error('该片段没有可调音量');
      if (item.keyframes?.volume?.length) throw new Error('该片段有音量关键帧，请先明确如何处理自动化音量');
      patch(item, { volume: change.volume });
      summary.push(`「${item.name}」音量 ${Math.round((item.volume ?? 1) * 100)}% → ${Math.round(change.volume * 100)}%`);
    } else {
      if (!['video', 'image'].includes(item.kind)) throw new Error('缩短镜头需要视频或图片片段');
      const delta = Math.round(change.seconds * timeline.fps);
      if (delta < 1 || delta >= item.durationInFrames) throw new Error('缩短后镜头至少保留一帧');
      if (timeline.transitions?.length) throw new Error('此时间线包含转场，请使用精确编辑工具核对转场后再调整时长');
      if (timeline.tracks?.some(t => t.trackType === 'caption')) throw new Error('原生字幕轨需要使用字幕工具同步调整');
      const cutEnd = item.startFrame + item.durationInFrames, cutStart = cutEnd - delta;
      const map = (t: number) => t <= cutStart ? t : t >= cutEnd ? t - delta : cutStart;
      let shifted = 0, trimmed = 0;
      for (const other of timeline.items) {
        const end = other.startFrame + other.durationInFrames;
        const startFrame = map(other.startFrame), durationInFrames = map(end) - startFrame;
        if (startFrame === other.startFrame && durationInFrames === other.durationInFrames) continue;
        itemById(other.id); // Enforce locked tracks for indirect changes as well.
        if (!['video', 'image', 'text', 'audio'].includes(other.kind)) throw new Error(`「${other.name}」类型不支持自动联动，请明确处理方式`);
        if (Object.values(other.keyframes ?? {}).some(points => points?.length) || other.hasTranscript) throw new Error(`「${other.name}」有关键帧或转录，请使用精确编辑工具处理联动`);
        if (['video', 'audio'].includes(other.kind) && ((other.speed ?? other.playbackRate ?? 1) !== 1 || other.sourceDurationInFrames != null && other.sourceDurationInFrames !== other.durationInFrames)) throw new Error('变速镜头需要单独核对源区间');
        const overlapsCut = other.startFrame < cutEnd && end > cutStart;
        if (other.id !== item.id && ['video', 'image'].includes(other.kind) && overlapsCut) throw new Error('裁切区间有重叠镜头，请明确应如何调整');
        if (other.kind === 'audio' && overlapsCut && !(other.startFrame === 0 && end === duration)) throw new Error('裁切区间有局部音频，请明确保留或裁切方式');
        if (durationInFrames === 0) {
          if (other.kind !== 'text') throw new Error('此次缩短会删除非文字片段，请明确删除意图');
          deletes.push({ type: other.kind, itemId: other.id });
          summary.push(`移除完全落在裁去区间的文字「${other.name}」`);
          continue;
        }
        const fields: Record<string, unknown> = {};
        if (startFrame !== other.startFrame) { fields.startFrame = startFrame; shifted++; }
        if (durationInFrames !== other.durationInFrames) {
          fields.durationInFrames = durationInFrames; trimmed++;
          if ((other.fadeInFrames ?? 0) > durationInFrames / 2) fields.fadeInSeconds = durationInFrames / 2 / timeline.fps;
          if ((other.fadeOutFrames ?? 0) > durationInFrames / 2) fields.fadeOutSeconds = durationInFrames / 2 / timeline.fps;
        }
        patch(other, fields);
        frames.add(startFrame + Math.floor(durationInFrames / 2));
      }
      finalDuration = map(duration);
      frames.add(Math.max(0, cutStart - 1)); frames.add(cutStart);
      summary.push(`「${item.name}」从尾部缩短 ${delta / timeline.fps} 秒；后移内容提前 ${delta / timeline.fps} 秒（移动 ${shifted} 项，调整长度 ${trimmed} 项）；总长 ${duration / timeline.fps} → ${finalDuration / timeline.fps} 秒；贯穿配乐连续播放并在新片尾结束`);
    }
  }
  if (deletes.some(d => updates.has(String(d.itemId)))) throw new Error('同一请求同时修改和移除文字，请分开调整');
  const sample = [...frames].map(f => Math.max(0, Math.min(f, finalDuration - 1))).sort((a, b) => a - b);
  const unique = [...new Set(sample)];
  const sampled = unique.length <= 6 ? unique : Array.from({ length: 6 }, (_, i) => unique[Math.round(i * (unique.length - 1) / 5)]);
  return { updates: [...updates.values()], deletes, frames: sampled, summary: summary.join('\n'), durationInFrames: finalDuration };
}

type Call = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<VideoToolResult>;
export async function refineDraft(input: unknown, editSessionId: string, call: Call, previews: CompositionPreviews, sessionId: string, signal?: AbortSignal): Promise<VideoToolResult> {
  const invoke = async (name: string, args: Record<string, unknown> = {}) => {
    signal?.throwIfAborted();
    const result = editorResult(await call(name, { ...args, editSessionId }, signal));
    if (result.error || result.ok === false) throw new Error(`${name}: ${String(result.error || '操作失败')}`);
    return result;
  };
  const status = await invoke('get_edit_session');
  if (status.status !== 'drafting') throw new Error('请先 resume_edit_session 续改待确认草稿；已应用的工程需 begin_edit_session 创建新草稿');
  const project = await invoke('read_project', { view: 'timeline' });
  const timeline = project.timeline as unknown as RefinementTimeline;
  const compiled = compileRefinement(input, timeline);
  await invoke('edit_item', { updates: compiled.updates, ...(compiled.deletes.length ? { deletes: compiled.deletes } : {}) });
  const after = (await invoke('read_project', { view: 'timeline' })).timeline as unknown as RefinementTimeline;
  if (Math.max(...after.items.map(i => i.startFrame + i.durationInFrames)) !== compiled.durationInFrames) throw new Error('草稿实际时长与计划不符，请检查后再提交审核');
  const rendered = await call('view_timeline_frames', { editSessionId, frames: compiled.frames }, signal);
  if (rendered.isError) throw new Error('修改已保留在草稿，但预览失败；请重新检查并渲染，不要重复修改');
  const preview = await previews.save(sessionId, { editSessionId, timelineId: timeline.id, name: timeline.name, summary: compiled.summary, frames: compiled.frames }, rendered);
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'drafting', preview, next: 'Inspect the new rendered frames, then call the top-level video_editor_review with this change summary; no duplicate frame render is needed. This is an unapplied local revision; do not compose/rebuild the timeline.' }) }, ...rendered.content.filter(p => p.type === 'image')] };
}
