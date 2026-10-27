import type { DirEntry } from './workspace';
import type { DeepLinkAction } from './deepLink';
import type { PluginPreview, PluginSummary } from './plugins';
import type {
  DingTalkConnectParams,
  FeishuConnectParams,
  GiteeConnectParams,
  GitHubConnectParams,
  GoogleOAuthParams,
  HookEntry,
  IntegrationConnectResult,
  McpServerEntry,
  McpTestResult,
  NodeEnvStatus,
  QuickIntegrationId,
  QuickIntegrationsStatus,
  WeComConnectParams,
  YuqueConnectParams,
} from './extensionConfig';

import type { McpCatalogPage, PluginCatalog } from './catalog';
import type {
  SkillHubInstallRequest,
  SkillHubInstallResult,
  SkillHubSearchQuery,
  SkillHubSearchResult,
} from './skillhub';

export interface ReizoBridge {
  accountStatus(): Promise<import('./account').AccountState>;
  accountLogin(): Promise<import('./account').AccountState>;
  accountPasswordLogin(input: import('./accountLogin').AccountPasswordLogin): Promise<import('./account').AccountState>;
  accountLogout(): Promise<import('./account').AccountState>;
  accountReopen(): Promise<import('./account').AccountState>;
  accountRefresh(): Promise<import('./account').AccountState>;
  accountWallet(input?: { organizationId?: string; order?: string }): Promise<import('./accountWallet').AccountWallet>;
  accountTopup(input: import('./accountWallet').AccountTopupInput): Promise<import('./accountWallet').AccountCheckout>;
  accountTopupOpen(input: { organizationId: string; order: string }): Promise<import('./accountWallet').AccountCheckout>;
  platform: NodeJS.Platform;
  getApiOrigin(): Promise<string>;
  openExternal(url: string): Promise<void>;
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
  /** Official MCP registry, searchable and paged by cursor. */
  searchMcpCatalog(query: { search?: string; cursor?: string }): Promise<McpCatalogPage>;
  /** Claude plugin marketplace (GitHub-hosted plugins). */
  listPluginCatalog(): Promise<PluginCatalog>;
  /** Downloads and installs a catalog plugin; it starts disabled. */
  installCatalogPlugin(id: string): Promise<PluginSummary>;
  /** User-level MCP servers (mcp.json), including disabled ones. Changes apply from the next turn. */
  listMcpServers(): Promise<McpServerEntry[]>;
  saveMcpServers(entries: McpServerEntry[]): Promise<void>;
  /** Connect one server alone and list its tools; never saves anything. */
  testMcpServer(entry: McpServerEntry): Promise<McpTestResult>;
  /** Clears the trust-on-first-use baseline for one or all servers (re-trusting their current schema). */
  resetMcpBaseline(serverName?: string): Promise<void>;
  listHooks(): Promise<HookEntry[]>;
  saveHooks(entries: HookEntry[]): Promise<void>;
  /** Opens a folder picker and installs the chosen extension pack (disabled until the user enables it). */
  relaunchApp(): Promise<void>;
  quickSubmit(text: string): Promise<boolean>;
  quickHide(): Promise<void>;
  onQuickAsk(callback: (text: string) => void): () => void;
  onScreenshot(callback: (payload: { dataUrl?: string; error?: string }) => void): () => void;
  onDeepLink(callback: (action: DeepLinkAction) => void): () => void;
  onQuickReset(callback: () => void): () => void;
  installPlugin(): Promise<PluginSummary | null>;
  setPluginConfig(id: string, name: string, value: string | null): Promise<void>;
  previewPlugin(): Promise<PluginPreview | null>;
  installPreviewedPlugin(sourceDir: string, digest: string): Promise<PluginSummary>;
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  uninstallPlugin(id: string): Promise<void>;
  uninstallSkill(id: string): Promise<void>;
  searchSkillHub(query: SkillHubSearchQuery): Promise<SkillHubSearchResult>;
  installSkillHubSkill(request: SkillHubInstallRequest): Promise<SkillHubInstallResult>;
  /** Fetch the SKILL.md text of a marketplace entry for preview. */
  previewSkillHubSkill(request: SkillHubInstallRequest): Promise<string>;
  /** Render an HTML document to PDF; resolves to base64 bytes. */
  exportPdf(html: string): Promise<string>;
  checkNodeEnvironment(): Promise<NodeEnvStatus>;
  getQuickIntegrationsStatus(): Promise<QuickIntegrationsStatus>;
  connectNotion(token: string): Promise<IntegrationConnectResult>;
  startGoogleOAuth(params: GoogleOAuthParams): Promise<IntegrationConnectResult>;
  connectFeishu(params: FeishuConnectParams): Promise<IntegrationConnectResult>;
  connectWeCom(params: WeComConnectParams): Promise<IntegrationConnectResult>;
  connectDingTalk(params: DingTalkConnectParams): Promise<IntegrationConnectResult>;
  connectYuque(params: YuqueConnectParams): Promise<IntegrationConnectResult>;
  connectGitee(params: GiteeConnectParams): Promise<IntegrationConnectResult>;
  connectGitHub(params: GitHubConnectParams): Promise<IntegrationConnectResult>;
  disconnectIntegration(id: QuickIntegrationId): Promise<IntegrationConnectResult>;
}


declare global {
  interface Window {
    reizo: ReizoBridge;
  }
}
