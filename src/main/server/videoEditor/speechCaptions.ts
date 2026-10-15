import type { VideoToolResult } from '../../../shared/videoEditor';
import { editorResult } from './mcpClient';
import { CompositionPreviews } from './composition';
type Call = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<VideoToolResult>;
interface Target { editSessionId: string; itemId: string }
interface CaptionPage { start: number; end: number; words: Array<{ wordRef: string; text: string }> }
interface Captions { enabled?: boolean; pages?: CaptionPage[]; sources?: Array<{ itemId?: string }> }

function invokeFor(input: Target, call: Call, signal?: AbortSignal) {
  return async (name: string, args: Record<string, unknown> = {}) => {
    signal?.throwIfAborted();
    const result = editorResult(await call(name, { editSessionId: input.editSessionId, ...args }, signal));
    if (result.error || result.ok === false) throw new Error(String(result.error || '字幕操作失败'));
    return result;
  };
}
async function scopedCaptions(input: Target, invoke: ReturnType<typeof invokeFor>) {
  const project = await invoke('read_project');
  const timeline = project.timeline as { id: string; fps: number; items: Array<{ id: string; kind: string; startFrame: number; durationInFrames: number; hasTranscript?: boolean }> };
  const item = timeline.items.find(i => i.id === input.itemId);
  if (!item || !['audio', 'video'].includes(item.kind)) throw new Error('指定语音片段不存在，请读取当前草稿');
  const captions = await invoke('read_captions') as Captions;
  if (!captions.enabled) {
    const listed = await invoke('read_captions', { list: true });
    if ((listed.tracks as Array<{ hasCaptions?: boolean }> | undefined)?.some(t => t.hasCaptions)) throw new Error('已有关闭的字幕配置，请明确是否恢复；未覆盖现有字幕');
    return { timeline, item, captions };
  }
  const source = await invoke('edit_captions', { action: 'source_list' });
  const sources = source.sources as Array<{ itemId?: string }> | undefined;
  const anchored = source.sourceMode !== 'timeline' && (sources?.length ? sources.every(s => s.itemId === input.itemId) : source.sourceItemId === input.itemId);
  if (captions.enabled && !anchored) throw new Error('已有其他来源的字幕，请明确如何合并；未覆盖现有字幕');
  return { timeline, item, captions };
}
async function preview(input: Target, invoke: ReturnType<typeof invokeFor>, call: Call, store: CompositionPreviews, sessionId: string, signal?: AbortSignal) {
  const { timeline, item, captions } = await scopedCaptions(input, invoke);
  const pages = captions.pages ?? [];
  if (!pages.length) throw new Error('当前片段范围内没有可显示字幕，请核对语音和源时间范围');
  const count = Math.min(4, pages.length);
  const frames = [...new Set(Array.from({ length: count }, (_, i) => pages[count === 1 ? 0 : Math.round(i * (pages.length - 1) / (count - 1))]).map(p => Math.max(item.startFrame, Math.min(item.startFrame + item.durationInFrames - 1, Math.round((p.start + p.end) / 2000 * timeline.fps)))))];
  const rendered = await call('view_timeline_frames', { editSessionId: input.editSessionId, frames }, signal);
  if (rendered.isError) throw new Error('字幕预览失败，请检查草稿');
  const summary = `语音字幕 · ${pages.length} 页\n${pages.slice(0, 8).map(p => `${(p.start / 1000).toFixed(2)}–${(p.end / 1000).toFixed(2)} 秒：${p.words.map(w => w.text).join('')}`).join('\n')}\n自动语音识别结果需核对；字幕显示校正不改原转录和片段时长。`;
  const saved = await store.save(sessionId, { editSessionId: input.editSessionId, timelineId: timeline.id, name: '语音字幕', summary, frames }, rendered);
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'drafting', preview: saved, captions, next: 'Inspect the actual composite images, correct mistakes through video_editor_subtitles if needed, then video_editor_review. Nothing has been applied.' }) }, ...rendered.content.filter(p => p.type === 'image')] };
}
export async function generateSpeechCaptions(input: Target & { jobId: string; language: string }, call: Call, store: CompositionPreviews, sessionId: string, signal?: AbortSignal) {
  const invoke = invokeFor(input, call, signal);
  const { captions } = await scopedCaptions(input, invoke);
  if (!captions.enabled) {
    await invoke('reizo_speech_job', { action: 'attach', itemId: input.itemId, jobId: input.jobId, language: input.language });
    await invoke('edit_captions', { action: 'enable' });
    await invoke('edit_captions', { action: 'source_set', json: JSON.stringify({ sources: [{ itemId: input.itemId }] }) });
  }
  return preview(input, invoke, call, store, sessionId, signal);
}
export async function correctSpeechCaptions(input: Target & { corrections: Array<{ wordRef: string; text?: string; forcePageBreak?: boolean }> }, call: Call, store: CompositionPreviews, sessionId: string, signal?: AbortSignal) {
  const invoke = invokeFor(input, call, signal);
  const { captions } = await scopedCaptions(input, invoke);
  const refs = new Set((captions.pages ?? []).flatMap(p => p.words.map(w => w.wordRef)));
  if (input.corrections.some(c => !refs.has(c.wordRef) || c.text === undefined && c.forcePageBreak === undefined) || new Set(input.corrections.map(c => c.wordRef)).size !== input.corrections.length) throw new Error('字幕引用过期、重复或没有修改，请先读取字幕');
  await invoke('edit_captions', { action: 'display_text', json: JSON.stringify({ overrides: input.corrections }) });
  return preview(input, invoke, call, store, sessionId, signal);
}
