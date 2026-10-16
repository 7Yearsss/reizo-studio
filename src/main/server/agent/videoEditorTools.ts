import { tool } from 'ai';
import { z } from 'zod';
import { videoEditorFor } from '../videoEditor/service';
import type { VideoToolResult } from '../../../shared/videoEditor';
import type { CanvasStore } from '../storage/canvasStore';
import { editorMediaFor } from '../videoEditor/mediaExchange';
import { editorObservationsFor } from '../videoEditor/observations';
import { buildComposition, CompositionPreviews } from '../videoEditor/composition';
import { videoCompositionSchema } from '../../../shared/videoComposition';
import { videoRefinementSchema } from '../../../shared/videoRefinement';
import { refineDraft } from '../videoEditor/refinement';
import { videoApprovalFor } from '../videoEditor/approval';
import { prepareVideoDraft } from '../videoEditor/prepare';
import { SourceInspections } from '../videoEditor/sourceInspection';
import { sourceInspectionSchema, shotSelectionsSchema } from '../../../shared/videoSelection';
import { createVideoSpeechTools } from './videoSpeechTools';
import { analyzeMediaFile } from '../videoEditor/mediaAnalysis';
import { resolveCanvasAssetFile } from '../canvas/assets';
import { assetAvailableInCanvas } from '../canvas/assetScope';

async function mediaToolOutput({ output }: { output: VideoToolResult }) {
  const value: Array<{ type: 'text'; text: string } | { type: 'file'; mediaType: string; data: { type: 'data'; data: string } }> = output.content.map((part) => {
    if (part.type === 'image' && part.data && part.mimeType) return { type: 'file', data: { type: 'data', data: part.data }, mediaType: part.mimeType };
    return { type: 'text', text: part.text || JSON.stringify(part) };
  });
  return { type: 'content' as const, value };
}

export function createVideoEditorTools(sessionId: string, dataRoot: string, canvasStore?: CanvasStore) {
  const editor = videoEditorFor(dataRoot);
  const observations = editorObservationsFor(dataRoot);
  return {
    ...createVideoSpeechTools(sessionId, dataRoot),
    video_editor_inspect_sources: tool({
      description: 'For theme-based source selection / highlights / automatic rough cuts, call video_editor_prepare, then this tool with exact selected video/image asset IDs from its editor pool. Returns actual labeled source contact sheets and durable evidence IDs, WITHOUT changing the timeline. Inspect visual content, not filenames. Up to 4 sources per batch; cover ALL user-requested candidates in batches before ranking. Default 6 samples per source; long clips need narrower candidate-range inspection before choosing trims. Preserve user-selected versions. Source frames use the project fps, not timeline positions. Does not listen, transcribe, detect all scene boundaries or guarantee motion quality. Never claim a full-video analysis from sparse stills. Then video_editor_rough_cut cites evidence, times and specific visual reasons. No tool discovery is needed.',
      inputSchema: sourceInspectionSchema,
      execute: async (input, { abortSignal }) => {
        observations.record(sessionId, 'working', `正在抽样查看 ${input.sources.length} 项素材的源画面`);
        try {
          const result = await new SourceInspections(dataRoot).inspect(sessionId, input, (name, args, signal) => editor.call(sessionId, name, args, signal), abortSignal);
          observations.record(sessionId, 'tool_returned', '源画面已返回，等待 Agent 根据实际画面选段');
          return result;
        } catch (error) {
          observations.record(sessionId, abortSignal?.aborted ? 'cancelled' : 'failed', `素材查看未完成：${error instanceof Error ? error.message : '未知错误'}`);
          throw error;
        }
      },
      toModelOutput: async ({ output }) => mediaToolOutput({ output: output as VideoToolResult }),
    }),
    video_editor_rough_cut: tool({
      description: 'Create a theme-based rough-cut draft AFTER visually inspecting source contact sheets with video_editor_inspect_sources. Provide a full composition plan and one selection per shot in the same order: evidenceId, actual observedFrames inside that source window, narrative role and concrete visual reason tied to the user theme. Choose strong opening, useful details, varied complementary shots and a clear ending where supported. Evidence must match this draft and exact source version. Video shot endpoints must be within 1 second of cited samples with no gap over 2 seconds; inspect a narrower range if coverage is too sparse. Do not pad with unrelated material to meet duration; explain insufficiency. No invented speech/subtitles/audio claims. This creates a separate editable sequence and visible selection rationale plus actual composite previews; inspect them and call video_editor_review. It does not apply or export. For user-specified exact shot plans use video_editor_compose; for later local revisions use video_editor_refine. Never blindly retry after failure: inspect the draft first.',
      inputSchema: z.object({ editSessionId: z.string().min(1).max(200), plan: videoCompositionSchema, selections: shotSelectionsSchema }).strict(),
      execute: async ({ editSessionId, plan, selections }, { abortSignal }) => {
        observations.record(sessionId, 'working', '正在核对选段依据并生成粗剪草稿');
        try {
          const validate = await new SourceInspections(dataRoot).validator(sessionId, editSessionId, plan, selections);
          const result = await buildComposition(plan, editSessionId, (name, args, signal) => editor.call(sessionId, name, args, signal), new CompositionPreviews(dataRoot), sessionId, abortSignal, validate);
          observations.record(sessionId, 'tool_returned', '粗剪草稿、选段理由和预览已生成，尚未应用');
          return result;
        } catch (error) {
          observations.record(sessionId, abortSignal?.aborted ? 'cancelled' : 'failed', `粗剪未完成：${error instanceof Error ? error.message : '未知错误'}；请检查草稿后继续`);
          throw error;
        }
      },
      toModelOutput: async ({ output }) => mediaToolOutput({ output: output as VideoToolResult }),
    }),
    video_editor_prepare: tool({
      description: 'Start here when the user asks to create or revise a video. In ONE call obtain current UI selection, approval mode, workbench asset versions, complete editor media pool, timeline items and the exact active editSessionId. Creates/reuses a manual draft and reopens a pending review for the requested revision, preserving earlier changes. Does not import media, edit timeline content or apply anything. Do not use for a read-only status question or to confirm an existing review. For theme-based source selection or highlights, next call video_editor_inspect_sources then video_editor_rough_cut, inspect its composite preview and review. For exact prescribed edits, directly call video_editor_refine (local text/volume/shorten changes) or video_editor_compose (new sequence), inspect their returned frame images, then video_editor_review. These are top-level tools; no video_editor_tools discovery needed for this workflow. Re-prepare after external changes/errors rather than using stale IDs.',
      inputSchema: z.object({}).strict(),
      execute: async (_input, { abortSignal }) => {
        const prepared = await prepareVideoDraft((name, args, signal) => editor.call(sessionId, name, args, signal), abortSignal);
        return { ...prepared, observation: observations.read(sessionId), approvalMode: await videoApprovalFor(dataRoot).read(sessionId),
          workbench: { scope: 'workbench', assets: canvasStore ? editorMediaFor(dataRoot, canvasStore).list(sessionId) : [], note: 'This is separate from project.mediaPool; reuse exact selected versions, never infer that an empty workbench means the editor pool is empty.' } };
      },
    }),
    video_editor_review: tool({
      description: 'After inspecting actual composite preview images returned by video_editor_compose/refine/rough_cut (source inspection alone is insufficient), submit this exact draft with a concise change summary. No extra schema lookup or duplicate view_timeline_frames call is needed if nothing changed since that preview. Manual mode waits for user confirmation; the user-enabled automatic mode applies the proposal. Read the returned status and never report applied unless it is applied. Do not invoke this through video_editor_call.',
      inputSchema: z.object({ editSessionId: z.string().min(1).max(200), summary: z.string().min(1).max(2000) }).strict(),
      execute: async ({ editSessionId, summary }, { abortSignal }) => {
        const result = await editor.call(sessionId, 'review_edit_session', { editSessionId, summary }, abortSignal);
        observations.record(sessionId, result.isError ? 'failed' : 'tool_returned', '剪辑提案已返回；确认状态以编辑器回执为准');
        return result;
      },
      toModelOutput: async ({ output }) => mediaToolOutput({ output: output as VideoToolResult }),
    }),
    video_editor_refine: tool({
      description: 'Make local revisions to an existing draft, preserving every unrelated clip, ID and source reference. Prefer this over compose for “标题小一点”, “第二段缩短两秒”, “音乐再轻一点”. First call video_editor_prepare once: it returns the editSessionId, exact item IDs, complete project and selection, and handles pending-review resumption. Do not repeat context/schema/project lookups already provided by prepare. Supported changes: text/fontSizeScale, absolute volume 0..1, and shorten_shot from its tail. shorten_shot automatically closes that time interval across later clips/text, clamps overlapping text, trims continuous full-length background music at the new end and preserves fades unless too long. Use only when the user wants subsequent content to follow the shortened shot; unrelated partial audio, transitions and animated timing require explicit lower-level editing. Submit one batch, inspect its returned actual preview and change summary, then call the top-level video_editor_review tool. Its returned images already are actual rendered previews; do not render the same frames again unless there is a visual problem or another edit. It never applies or reviews automatically. After an error read the current draft; never blindly repeat relative changes. Do not call compose or rebuild a timeline for these revisions.',
      inputSchema: z.object({ editSessionId: z.string().min(1).max(200), changes: videoRefinementSchema }),
      execute: async ({ editSessionId, changes }, { abortSignal }) => {
        observations.record(sessionId, 'working', '正在局部修改草稿并更新预览');
        try {
          const result = await refineDraft(changes, editSessionId, (name, args, signal) => editor.call(sessionId, name, args, signal), new CompositionPreviews(dataRoot), sessionId, abortSignal);
          observations.record(sessionId, 'tool_returned', '局部修改与新预览已生成，尚未应用');
          return result;
        } catch (error) {
          observations.record(sessionId, 'failed', `局部修改未完成：${error instanceof Error ? error.message : '未知错误'}；请读取当前草稿后继续`);
          throw error;
        }
      },
      toModelOutput: async ({ output }) => mediaToolOutput({ output: output as VideoToolResult }),
    }),
    video_editor_compose: tool({
      description: 'Build a complete video composition from a user-prescribed exact shot plan inside a fresh manual edit draft. When the user delegates theme-based source selection or highlights, use video_editor_inspect_sources then video_editor_rough_cut instead, with visual evidence and reasons. For requests like “剪成30秒竖屏，加标题字幕和背景音乐”, first call video_editor_prepare once to get the draft ID, selection, full timeline and both asset lists. No lifecycle/schema discovery is needed for this standard workflow. There are TWO asset sources: the workbench canvas (video_editor_media list/import), and the editor media pool (local files may exist only here). Use project.mediaPool from prepare before declaring requested files missing; reuse its exact asset IDs without reimporting. If an asset must be transferred from the workbench, import it before beginning the composition draft, then reread the project. Use COMPLETE editor media IDs, verified source ranges, and user-provided/verified transcript/authored-copy captions (never pretend invented copy is transcription). Missing music/transcript must be disclosed, not silently omitted. This tool creates a separate timeline with ordered trimmed shots, title, timed editable caption text clips, music volume/fades and aspect ratio. It validates durations and returns rendered keyframes plus a saved user-visible preview. Inspect those images, refine if needed, then call video_editor_review with the returned summary. These returned images already count as the actual preview; do not render them again unless needed. Nothing is automatically reviewed or applied. For follow-up changes call video_editor_prepare to reuse/resume the right draft, then video_editor_refine; do not discard or rebuild. Never retry compose blindly after an error: inspect the draft first.',
      inputSchema: z.object({ editSessionId: z.string().min(1).max(200), plan: videoCompositionSchema }),
      execute: async ({ editSessionId, plan }, { abortSignal }) => {
        observations.record(sessionId, 'working', `正在编排「${plan.name}」并渲染关键帧`);
        try {
          const result = await buildComposition(plan, editSessionId, (name, args, signal) => editor.call(sessionId, name, args, signal), new CompositionPreviews(dataRoot), sessionId, abortSignal);
          observations.record(sessionId, 'tool_returned', `「${plan.name}」草稿与关键帧已生成，尚未应用`);
          return result;
        } catch (error) {
          observations.record(sessionId, abortSignal?.aborted ? 'cancelled' : 'failed', `编排未完成：${error instanceof Error ? error.message : '未知错误'}；请检查草稿后继续`);
          throw error;
        }
      },
      toModelOutput: async ({ output }) => mediaToolOutput({ output: output as VideoToolResult }),
    }),
    video_editor_context: tool({
      description: 'Read the live video editor selection, active timeline, playhead (frames), pending review/confirmation, export state and recent factual activity. For read-only status questions use this tool. For an editing request use video_editor_prepare instead; it includes this context, full assets/timeline and the ready draft ID in one call. connected=false means no current UI context: ask the user to open the video panel; never use stale selection. selectedMedia lists only the current selection, NOT the whole media pool; an empty selection or empty timeline does not mean there are no imported assets. Empty selection is not permission to choose the newest asset. To discover editor assets, begin a manual edit session and read_project(view:"assets") with its editSessionId. Awaiting review is not applied; saved means the host durably stored the media. This tool does not edit or start a model/API call.',
      inputSchema: z.object({}),
      execute: async () => ({ ...observations.read(sessionId), approvalMode: await videoApprovalFor(dataRoot).read(sessionId), approvalNote: 'manual: 用户可在编辑器应用，或单独发送“应用这一版”。auto: 修改后先查看实际预览，review_edit_session 将应用整份提案，仍可撤销；导出确认独立。' }),
    }),
    ...(canvasStore ? { video_editor_analyze: tool({
      description: 'Objectively analyze ONE exact workbench video/audio asset version (an assetId from video_editor_media list) with local FFmpeg, no model or upload: silent intervals, the complement "soundSegments" (where sound is present, NOT proof of speech; use video_editor_speech for words), and visual scene-cut timestamps. Use it to plan rough cuts: drop dead air and pauses, split long takes at scene cuts, then pass exact source windows to video_editor_compose or video_editor_rough_cut. Scene cuts are a heuristic (raise sceneThreshold if too many, lower if cuts are missed); silence depends on silenceDb. Files imported only inside the editor media pool are not available here; reuse them through the workbench first.',
      inputSchema: z.object({
        assetId: z.string().min(1),
        silence: z.boolean().default(true),
        scenes: z.boolean().default(true),
        silenceDb: z.number().min(-70).max(-10).default(-35),
        minSilenceSeconds: z.number().min(0.2).max(5).default(0.6),
        sceneThreshold: z.number().min(0.1).max(0.9).default(0.3),
      }).strict(),
      execute: async (input, { abortSignal }) => {
        const canvas = canvasStore.findCanvasBySession(sessionId);
        const asset = canvas ? canvasStore.assets.get(input.assetId) : undefined;
        if (!canvas || !asset || !['video', 'audio'].includes(asset.kind) || !assetAvailableInCanvas(canvasStore, canvas.id, asset)) throw new Error('素材不在当前对话中或不是视频/音频，请使用 video_editor_media list 返回的 assetId');
        if (!input.silence && !input.scenes) throw new Error('请至少开启静音检测或镜头切换检测之一');
        observations.record(sessionId, 'working', `正在分析素材「${asset.name ?? asset.id}」的静音与镜头切换`);
        try {
          const file = await resolveCanvasAssetFile(dataRoot, asset.path);
          const result = await analyzeMediaFile(file, input, AbortSignal.any([...(abortSignal ? [abortSignal] : []), AbortSignal.timeout(300_000)]));
          observations.record(sessionId, 'tool_returned', '素材分析完成');
          return { assetId: asset.id, name: asset.name, ...result, note: '静音与镜头切换为本地 FFmpeg 的客观检测结果；声音段不代表有人声，镜头切换是启发式结果，剪辑前请结合源画面核对。' };
        } catch (error) {
          observations.record(sessionId, abortSignal?.aborted ? 'cancelled' : 'failed', `素材分析未完成：${error instanceof Error ? error.message : '未知错误'}`);
          throw error;
        }
      },
    }) } : {}),
    ...(canvasStore ? { video_editor_media: tool({
      description: 'List immutable image/video/audio asset versions in this conversation’s WORKBENCH CANVAS, or import one exact workbench assetId into its open video editor media pool. This list does NOT enumerate files imported directly through the editor file picker. An empty list means only the workbench canvas is empty; inspect the editor media pool via begin_edit_session then read_project(view:"assets", editSessionId) before reporting missing files. Already-imported editor assets need no transfer. Choose the user-selected version; never assume the newest output. Cross-conversation assets must first be reused in this canvas. Import preserves the source and does not change the timeline. Returns editorAssetId for subsequent draft editing. Keep the video panel open. Completed UI video/audio exports are automatically saved back to the canvas and asset library (剪辑成片).',
      inputSchema: z.discriminatedUnion('action', [z.object({ action: z.literal('list') }), z.object({ action: z.literal('import'), assetId: z.string().min(1) })]),
      execute: async (input) => {
        const media = editorMediaFor(dataRoot, canvasStore);
        if (input.action === 'list') return {
          scope: 'workbench' as const,
          assets: media.list(sessionId),
          editorMediaPool: {
            status: 'not_inspected' as const,
            note: 'Files imported in the video editor can exist even when this workbench list is empty. Do not report them missing from this result.',
          },
          nextStep: 'Discover begin_edit_session and read_project with video_editor_tools. Begin a manual session, then call read_project with view:"assets" and the returned editSessionId to inspect the current editor media pool. Reuse matching editor asset IDs; do not reimport existing files.',
        };
        await editor.catalog(sessionId); // Require the current editor to be connected before queuing bytes.
        const workspace = await editor.open(sessionId, '');
        return media.import(sessionId, workspace.projectId, input.assetId);
      },
    }) } : {}),
    video_editor_tools: tool({
      description: 'Discover ADVANCED low-level editing tools for this conversation’s open 视频剪辑 panel. For standard composition or title/volume/shorten edits, use video_editor_prepare → video_editor_compose/refine → video_editor_review directly instead; do not discover those top-level host tools here. Without names, returns a brief catalog; supply up to 8 names to read their exact input schemas before calling them. The user must open the panel first. Workflow: begin_edit_session, read_project/read_timeline, edit draft, view_timeline_frames, review_edit_session. To continue a pending review, discover resume_edit_session and reopen that exact draft, preserving earlier edits; do not discard it. Read approvalMode from video_editor_context. In manual mode the user applies in the editor or sends “应用这一版” for direct host application. In auto mode review_edit_session applies the complete proposal only after previewing the latest edits; never set upstream approvalMode:auto. awaiting_review means NOT applied. Never poll awaiting_review repeatedly. Do not use generation APIs or invent arguments.',
      inputSchema: z.object({ names: z.array(z.string()).max(8).optional() }),
      execute: async ({ names }) => {
        const tools = await editor.catalog(sessionId);
        return { tools: names ? tools.filter((t) => names.includes(t.name)) : tools.map((t) => ({ name: t.name, description: t.description?.slice(0, 120) })) };
      },
    }),
    video_editor_call: tool({
      description: 'Execute one tool discovered by video_editor_tools against ONLY this conversation’s video project. Project reads (read_project/read_timeline) and edits require an active editSessionId: begin_edit_session first and pass its returned ID, including when starting a follow-up after Apply/Reject. Review submits a draft for manual approval or, if the user enabled 自动应用, applies it after the latest actual preview. A standalone user “应用这一版” is executed directly by the host without a model call; never emulate confirmation or change a pending review to apply it. Do not claim completion until applied. UI undo is one atomic step. Use video_editor_media to import Reizo assets before beginning a draft; files imported through the editor picker are already in read_project mediaPool and need no transfer. Keep the video panel open. After a transport error inspect state before retrying a mutation. Export only the applied timeline via submit_render_job (separate confirmation in editor) and track_export; or the user can use 导出回素材库. Never claim an export finished until its status is complete.',
      inputSchema: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
      execute: async ({ name, arguments: args }, { abortSignal }) => {
        if (name.startsWith('video_editor_')) throw new Error(`${name} 是工作台一级工具，请直接调用它；不要放进 video_editor_call，也不需要通过 video_editor_tools 查询它。`);
        observations.record(sessionId, 'working', `Agent 正在执行剪辑工具：${name}`);
        try {
          const result = await editor.call(sessionId, name, args, abortSignal);
          observations.record(sessionId, result.isError ? 'failed' : 'tool_returned', `${name}${result.isError ? ' 返回错误' : ' 已返回结果'}；应用和保存状态以编辑器回执为准`);
          return result;
        }
        catch (error) {
          observations.record(sessionId, abortSignal?.aborted ? 'cancelled' : 'failed', `${name}：${error instanceof Error ? error.message : '调用失败'}`);
          throw error;
        }
      },
      toModelOutput: async ({ output }) => mediaToolOutput({ output: output as VideoToolResult }),
    }),
  };
}
