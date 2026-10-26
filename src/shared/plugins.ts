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
  /** The folder it was imported from has changed since (compared by content, so an unchanged version number still shows). */
  updateAvailable?: boolean;
  /** Credentials the pack asks for (`${config.NAME}`) and whether the user has supplied each; values are never exposed. */
  config?: Array<{ name: string; set: boolean }>;
}

/** What importing a folder would install — shown to the user BEFORE anything is copied or started. */
export interface PluginPreview {
  sourceDir: string;
  /** Content fingerprint; the install is refused if the folder no longer matches it. */
  digest: string;
  summary: Omit<PluginSummary, 'enabled'>;
  /** Already installed: its version, and whether this import would change anything. */
  existing?: { version?: string; sameContent: boolean };
}
