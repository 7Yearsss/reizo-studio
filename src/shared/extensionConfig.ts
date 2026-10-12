/** Wire types for the Settings → Extensions page (user-level MCP servers and hooks). */

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServerEntry {
  name: string;
  transport: McpTransport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** http / sse */
  url?: string;
  headers?: Record<string, string>;
  /** Kept in the file but not connected. */
  disabled?: boolean;
}

export interface McpTestResult {
  ok: boolean;
  /** Tools the server exposes, as the agent will see them. */
  tools: Array<{ name: string; description: string }>;
  /** Why it failed, or tools withheld, etc. */
  messages: string[];
}

export interface HookEntry {
  event: 'PreToolUse' | 'PostToolUse';
  /** Regex over the tool name; empty means every tool. */
  matcher?: string;
  command: string;
  timeoutMs?: number;
}
