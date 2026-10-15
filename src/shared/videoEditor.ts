export interface VideoEditorWorkspace {
  projectId: string;
  name: string;
  url: string;
}

export interface EditorImportJob { id: string; projectId: string; assetId: string; contentHash: string; name: string; label: string; mimeType: string }
export interface EditorImportResult { sourceAssetId: string; editorAssetId: string; name: string; durationInFrames?: number }

/** Deliberately excludes model generation, settings, arbitrary downloads and project deletion. */
export const VIDEO_EDITOR_TOOLS = new Set([
  'reizo_speech_job', 'read_transcript', 'find_transcript',
  'load_skill', 'read_project', 'read_timeline', 'read_captions', 'read_script',
  'read_agent_artifact', 'view_timeline_frames', 'view_asset_frames',
  'begin_edit_session', 'get_edit_session', 'resume_edit_session', 'review_edit_session', 'discard_edit_session',
  'list_edit_sessions', 'recover_edit_session',
  'update_item_props', 'move_item', 'set_item_timing', 'duplicate_item', 'remove_item',
  'split_item', 'add_audio', 'edit_item', 'edit_track', 'edit_captions', 'manage_effects',
  'manage_markers', 'set_aspect_ratio', 'manage_timelines', 'import_timeline',
  'add_motion_graphic', 'list_templates', 'search_templates', 'list_audio',
  'update_watermark',
  'submit_render_job', 'track_export', 'read_export_history', 'verify_export',
]);

export interface VideoToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
export interface VideoToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}
