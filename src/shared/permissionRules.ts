import type { PermissionMode } from './settings';

/** Tools that change files, memory or reach the network (asked about in `ask` mode, allowed in `workspace`). */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file', 'personal_memory_write', 'personal_memory_delete', 'http_fetch', 'web_search', 'browser_read', 'browser_open', 'analyze_video']);
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['run_command']);
/**
 * Tools that drive the user's real machine (mouse / keyboard / screen). Always
 * gated on first use regardless of `permissionMode` — even `full` prompts once,
 * then `allow-session` lets the agent run the rest of the turn uninterrupted.
 */
export const CONTROL_TOOLS: ReadonlySet<string> = new Set(['computer']);
/**
 * Tools that leave durable state behind (an unattended recurring run, a standing instruction). A single
 * injected sentence in a web page or document is enough to plant one, so every call is confirmed on its
 * own: `full` mode does not waive it and an `allow-session` answer is treated as a one-time allow.
 */
export const ALWAYS_ASK_TOOLS: ReadonlySet<string> = new Set(['create_schedule', 'delete_schedule', 'computer_confirm', 'propose_skill', 'computer_app']);

export function needsApproval(mode: PermissionMode, toolName: string): boolean {
  if (CONTROL_TOOLS.has(toolName) || ALWAYS_ASK_TOOLS.has(toolName)) return true;
  // Third-party MCP servers: ask (once per tool per session) unless the user chose full access.
  if (toolName.startsWith('mcp__')) return mode !== 'full';
  if (mode === 'full') return false;
  if (WRITE_TOOLS.has(toolName)) return mode === 'ask';
  if (SHELL_TOOLS.has(toolName)) return true;
  return false;
}

export interface EffectiveRule {
  group: string;
  /** Tool names (or a pattern) the rule covers. */
  tools: string[];
  effect: 'run' | 'ask';
  /** Which rule decides it, in words the user can check against the mode they picked. */
  because: string;
}

/** What the engine actually does in `mode`, computed with `needsApproval` itself so the list cannot drift from the behaviour. */
export function effectiveRules(mode: PermissionMode): EffectiveRule[] {
  const effect = (tool: string): 'run' | 'ask' => (needsApproval(mode, tool) ? 'ask' : 'run');
  return [
    { group: '读取（读文件、搜索、列目录）', tools: ['read_file', 'grep', 'find_files', 'list_dir'], effect: effect('read_file'), because: '只读，不改动任何东西' },
    { group: '写文件、记忆、联网', tools: [...WRITE_TOOLS], effect: effect('write_file'), because: mode === 'ask' ? '当前是「每次询问」' : mode === 'workspace' ? '当前是「工作区可写」' : '当前是「全部允许」' },
    { group: '运行命令', tools: [...SHELL_TOOLS], effect: effect('run_command'), because: mode === 'full' ? '当前是「全部允许」' : '命令除只读 git 外总会询问' },
    { group: '外部 MCP 工具', tools: ['mcp__*'], effect: effect('mcp__server__tool'), because: mode === 'full' ? '当前是「全部允许」' : '第三方工具每个会话首次使用时询问' },
    { group: '控制你的电脑', tools: [...CONTROL_TOOLS], effect: 'ask', because: '任何模式下首次使用都要你同意' },
    { group: '留下持久状态（定时任务、技能提议、敏感操作确认）', tools: [...ALWAYS_ASK_TOOLS], effect: 'ask', because: '每次都单独确认，「全部允许」也不豁免' },
  ];
}
