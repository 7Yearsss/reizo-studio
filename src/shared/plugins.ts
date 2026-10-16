/** Wire types for installed extension packs ("plugins"): a folder bundling skills, MCP servers and hooks. */

export interface PluginMcpServerInfo {
  name: string;
  kind: 'stdio' | 'http' | 'sse';
  /** The command line (stdio) or URL (http/sse) — shown so the user sees what enabling will run or contact. */
  target: string;
}

export interface PluginHookInfo {
  event: string;
  matcher?: string;
  command: string;
}

export interface PluginSummary {
  id: string;
  name: string;
  version?: string;
  description?: string;
  format: 'claude' | 'codex' | 'plain';
  enabled: boolean;
  skills: string[];
  mcpServers: PluginMcpServerInfo[];
  hooks: PluginHookInfo[];
  /** Things the plugin declares that Reizo cannot use (unsupported hook events, unreadable files). */
  warnings: string[];
}
