import { tool } from 'ai';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { videoEditorFor } from '../videoEditor/service';
import { editorResult } from '../videoEditor/mcpClient';
import { editorObservationsFor } from '../videoEditor/observations';
import { CompositionPreviews } from '../videoEditor/composition';
import { generateSpeechCaptions, correctSpeechCaptions } from '../videoEditor/speechCaptions';
import type { VideoToolResult } from '../../../shared/videoEditor';

const id = z.string().min(1).max(200);
export function createVideoSpeechTools(sessionId: string, root: string) {
  const editor = videoEditorFor(root), observations = editorObservationsFor(root);
  const call = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => editor.call(sessionId, name, args, signal);
  return {
    video_editor_speech: tool({
      description: 'Recognize speech locally on ONE exact current draft audio/video item. First video_editor_prepare and inspect its exact item ID. start begins asynchronous on-device Whisper (no paid API/upload); it returns a jobId, NOT completion. If model missing, direct user to editor 语音字幕 → 下载模型. status with waitSeconds:15 polls the same job; keep the panel open. Do not repeatedly start; never invent transcript or infer done from elapsed time. A stopped chat does not automatically stop ASR: cancel explicitly if user cancels recognition. Retry failed/interrupted jobs only when asked, using start retry:true. When status=done with wordCount>0, call video_editor_subtitles action=generate with the same jobId/language/itemId. Only that step attaches recognition and subtitles to the draft. No speech means no subtitles. Recognizes the full source; subtitle projection respects the clip source window. zh/en supported; no translation or speaker separation.',
      inputSchema: z.object({ action: z.enum(['start', 'status', 'cancel']), editSessionId: id, itemId: id, language: z.enum(['zh', 'en']).default('zh'), jobId: z.string().regex(/^[a-f0-9]{64}$/).optional(), waitSeconds: z.number().int().min(0).max(20).default(0), retry: z.boolean().default(false) }).strict(),
      execute: async ({ action, editSessionId, itemId, language, jobId, waitSeconds, retry }, { abortSignal }) => {
        if (action === 'status' && waitSeconds) await delay(waitSeconds * 1000, undefined, { signal: abortSignal });
        const result = editorResult(await call('reizo_speech_job', { action, editSessionId, itemId, language, ...(jobId ? { jobId } : {}), retry }, abortSignal));
        const status = String(result.status);
        observations.record(sessionId, ['failed', 'interrupted'].includes(status) ? 'failed' : status === 'cancelled' ? 'cancelled' : status === 'running' ? 'working' : 'tool_returned', `本地语音识别：${({ running: '进行中，请保持剪辑面板打开', done: '完成，尚未生成字幕草稿', failed: '失败', interrupted: '已中断，可重试', cancelled: '已取消' })[status] ?? status}${result.error ? `；${result.error}` : ''}`);
        return result;
      },
    }),
    video_editor_subtitles: tool({
      description: 'Generate/read/correct native timed subtitles for one exact draft clip. generate requires a completed local speech jobId, same itemId and language; existing unrelated captions are never overwritten. read returns source transcript phrases and subtitle pages with stable wordRef values. correct changes ONLY subtitle display text/line breaks using exact wordRefs from read, preserving source transcript, timestamps and clip duration; do not invent refs. generate/correct return actual rendered composite previews: inspect and call video_editor_review. ASR is machine recognition and may contain mistakes, never label it human-verified. No automatic application/export. Existing applied subtitle edits first use prepare to open a fresh draft. For semantic source lookup use read_transcript/find_transcript on the attached real transcript; do not delete spoken content without an explicit request.',
      inputSchema: z.discriminatedUnion('action', [
        z.object({ action: z.literal('generate'), editSessionId: id, itemId: id, jobId: z.string().regex(/^[a-f0-9]{64}$/), language: z.enum(['zh', 'en']).default('zh') }).strict(),
        z.object({ action: z.literal('read'), editSessionId: id, itemId: id }).strict(),
        z.object({ action: z.literal('correct'), editSessionId: id, itemId: id, corrections: z.array(z.object({ wordRef: id, text: z.string().max(60).optional(), forcePageBreak: z.boolean().optional() }).strict()).min(1).max(100) }).strict(),
      ]),
      execute: async (input, { abortSignal }) => {
        if (input.action === 'read') return { content: [{ type: 'text', text: JSON.stringify({ transcript: editorResult(await call('read_transcript', { editSessionId: input.editSessionId, itemId: input.itemId }, abortSignal)), captions: editorResult(await call('read_captions', { editSessionId: input.editSessionId }, abortSignal)) }) }] };
        observations.record(sessionId, 'working', input.action === 'generate' ? '正在生成时间轴字幕及预览' : '正在校正字幕显示文字及预览');
        try {
          const previews = new CompositionPreviews(root);
          const result = input.action === 'generate' ? await generateSpeechCaptions(input, call, previews, sessionId, abortSignal) : await correctSpeechCaptions(input, call, previews, sessionId, abortSignal);
          observations.record(sessionId, 'tool_returned', '字幕草稿及预览已生成，自动识别文字需核对，尚未应用');
          return result;
        } catch (error) { observations.record(sessionId, 'failed', `字幕操作未完成：${error instanceof Error ? error.message : '未知错误'}；请读取草稿后继续`); throw error; }
      },
      toModelOutput: async ({ output }) => ({ type: 'content' as const, value: (output as VideoToolResult).content.map(p => p.type === 'image' && p.data && p.mimeType ? { type: 'file' as const, mediaType: p.mimeType, data: { type: 'data' as const, data: p.data } } : { type: 'text' as const, text: p.text ?? '' }) }),
    }),
  };
}
