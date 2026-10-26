import type { PermissionMode } from '../../../shared/settings';
import type { RunPermission } from '../../../shared/schedule';

/**
 * Tools an unattended read-only run may use. Default-deny: a tool that is not listed here (new built-in,
 * MCP tool, anything) is withheld, so adding capability can never silently widen an automation.
 */
export const READ_ONLY_RUN_TOOLS: ReadonlySet<string> = new Set([
  'read_file', 'read_attachment', 'read_background', 'find_files', 'grep', 'list_dir', 'memory_read',
  'read_canvas', 'read_node', 'read_sheet', 'read_document', 'read_presentation', 'read_delivery_plans',
  'check_sheet', 'check_document', 'check_delivery', 'get_video_models', 'list_assets', 'list_schedules',
  'todo_write', 'ask_user', 'video_editor_context', 'delegate_research', 'run_batch',
]);

/** The permission mode a run may use: the global mode, tightened — never loosened — by the run's ceiling. */
export function effectiveRunMode(global: PermissionMode, ceiling: RunPermission | undefined): PermissionMode {
  if (ceiling === 'readonly') return 'ask';
  if (ceiling === 'workspace' && global === 'full') return 'workspace';
  return global;
}

/** Drop every tool a read-only run may not call; other ceilings keep the toolset (their limit is the permission mode). */
export function applyRunCeiling<T extends Record<string, unknown>>(tools: T, ceiling: RunPermission | undefined): T {
  if (ceiling !== 'readonly') return tools;
  return Object.fromEntries(Object.entries(tools).filter(([name]) => READ_ONLY_RUN_TOOLS.has(name))) as T;
}

export const READ_ONLY_RUN_NOTICE =
  'This is an unattended, read-only automation run. You can read and analyse, but you cannot modify files, run commands, call external tools or create automations — those tools are not available. Put the full result in your reply text, and say plainly if the task needs a write you cannot make.';
