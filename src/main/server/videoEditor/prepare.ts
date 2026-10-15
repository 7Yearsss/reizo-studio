import type { VideoToolResult } from '../../../shared/videoEditor';
import { editorResult } from './mcpClient';

type Call = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<VideoToolResult>;

/** Prepare only for an explicit editing request. No media import or timeline mutation. */
export async function prepareVideoDraft(call: Call, signal?: AbortSignal) {
  const invoke = async (name: string, args: Record<string, unknown>) => {
    signal?.throwIfAborted();
    const value = editorResult(await call(name, args, signal));
    if (value.error || value.ok === false) throw new Error(`${name}: ${String(value.error || '操作失败')}`);
    return value;
  };
  let draft = await invoke('begin_edit_session', { reuseExisting: true });
  if (typeof draft.editSessionId !== 'string' || draft.stale === true) throw new Error('剪辑草稿已过期或缺少标识，请检查当前工程。');
  const editSessionId = draft.editSessionId;
  const resumedReview = draft.status === 'awaiting_review';
  if (resumedReview) draft = await invoke('resume_edit_session', { editSessionId });
  if (draft.status !== 'drafting' || draft.editSessionId !== editSessionId) throw new Error('无法准备当前剪辑草稿，请检查工程状态。');
  // Omitting view is upstream's supported full overview, not view:"full".
  const project = await invoke('read_project', { editSessionId });
  return {
    editSessionId, draft, resumedReview, project,
    next: 'Use these exact item/asset IDs. For title, volume or shortening use video_editor_refine directly; for a user-prescribed exact shot plan use video_editor_compose directly. For automatic thematic selection/highlights, call video_editor_inspect_sources on the requested assets, inspect returned source images, then video_editor_rough_cut with evidence and reasons. Both return actual preview images: inspect those and call video_editor_review. No schema discovery, repeated project reads or duplicate frame rendering is needed for this standard workflow. These video_editor_* tools are top-level host tools, never names for video_editor_call. Refresh after out-of-band changes or an error; never retry a relative edit blindly.',
  };
}
