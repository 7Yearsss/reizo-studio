import type { DirEntry } from './workspace';
import type { PluginSummary } from './plugins';
import type { HookEntry, McpServerEntry, McpTestResult } from './extensionConfig';
import type {
  SkillHubInstallRequest,
  SkillHubInstallResult,
  SkillHubSearchQuery,
  SkillHubSearchResult,
} from './skillhub';

export interface ReizoBridge {
  platform: NodeJS.Platform;
  getApiOrigin(): Promise<string>;
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<boolean>;
  windowClose(): Promise<void>;
  windowIsMaximized(): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  listWorkspace(relativePath?: string): Promise<DirEntry[]>;
  readWorkspaceFile(relativePath: string): Promise<{ relativePath: string; content: string; truncated: boolean }>;
  flattenWorkspace(): Promise<DirEntry[]>;
  runCommand(command: string): Promise<{ command: string; cwd: string; stdout: string; stderr: string; exitCode: number }>;
  readDroppedFile(file: File): Promise<{ name: string; content: string; truncated: boolean }>;
  revealInFolder(relativePath?: string): Promise<void>;
  deleteWorkspacePath(relativePath: string): Promise<{ path: string }>;
  createWorkspaceEntry(relativePath: string, kind: 'file' | 'dir'): Promise<{ path: string; kind: 'file' | 'dir' }>;
  gitStatus(): Promise<{
    available: boolean;
    branch: string | null;
    dirty: boolean;
    porcelain: string;
    recent: string;
  }>;
  installSkill(): Promise<{ id: string } | null>;
  listPlugins(): Promise<PluginSummary[]>;
  /** User-level MCP servers (mcp.json), including disabled ones. Changes apply from the next turn. */
  listMcpServers(): Promise<McpServerEntry[]>;
  saveMcpServers(entries: McpServerEntry[]): Promise<void>;
  /** Connect one server alone and list its tools; never saves anything. */
  testMcpServer(entry: McpServerEntry): Promise<McpTestResult>;
  listHooks(): Promise<HookEntry[]>;
  saveHooks(entries: HookEntry[]): Promise<void>;
  /** Opens a folder picker and installs the chosen extension pack (disabled until the user enables it). */
  installPlugin(): Promise<PluginSummary | null>;
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  uninstallPlugin(id: string): Promise<void>;
  uninstallSkill(id: string): Promise<void>;
  searchSkillHub(query: SkillHubSearchQuery): Promise<SkillHubSearchResult>;
  installSkillHubSkill(request: SkillHubInstallRequest): Promise<SkillHubInstallResult>;
  /** Fetch the SKILL.md text of a marketplace entry for preview. */
  previewSkillHubSkill(request: SkillHubInstallRequest): Promise<string>;
  /** Render an HTML document to PDF; resolves to base64 bytes. */
  exportPdf(html: string): Promise<string>;
}

declare global {
  interface Window {
    reizo: ReizoBridge;
  }
}
