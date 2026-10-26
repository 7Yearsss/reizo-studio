import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/constants';
import type { DirEntry } from '../shared/workspace';
import type { SkillHubInstallRequest, SkillHubSearchQuery } from '../shared/skillhub';
import type { PluginSummary } from '../shared/plugins';
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
} from '../shared/extensionConfig';

import type { McpCatalogPage, PluginCatalog } from '../shared/catalog';

contextBridge.exposeInMainWorld('reizo', {
  accountStatus: () => ipcRenderer.invoke(IPC.ACCOUNT_STATUS),
  accountLogin: () => ipcRenderer.invoke(IPC.ACCOUNT_LOGIN),
  accountPasswordLogin: (input: import('../shared/accountLogin').AccountPasswordLogin) => ipcRenderer.invoke(IPC.ACCOUNT_PASSWORD_LOGIN, input),
  accountLogout: () => ipcRenderer.invoke(IPC.ACCOUNT_LOGOUT),
  accountReopen: () => ipcRenderer.invoke(IPC.ACCOUNT_REOPEN),
  accountRefresh: () => ipcRenderer.invoke(IPC.ACCOUNT_REFRESH),
  accountWallet: (input?: { organizationId?: string; order?: string }) => ipcRenderer.invoke(IPC.ACCOUNT_WALLET, input),
  accountTopup: (input: import('../shared/accountWallet').AccountTopupInput) => ipcRenderer.invoke(IPC.ACCOUNT_TOPUP, input),
  accountTopupOpen: (input: { organizationId: string; order: string }) => ipcRenderer.invoke(IPC.ACCOUNT_TOPUP_OPEN, input),
  platform: process.platform,
  getApiOrigin: (): Promise<string> => ipcRenderer.invoke(IPC.GET_API_ORIGIN),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
  windowToggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_MAXIMIZE),
  windowClose: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.WORKSPACE_PICK),
  listWorkspace: (relativePath?: string): Promise<DirEntry[]> =>
    ipcRenderer.invoke(IPC.WORKSPACE_LIST, relativePath),
  readWorkspaceFile: (relativePath: string) => ipcRenderer.invoke(IPC.WORKSPACE_READ, relativePath),
  flattenWorkspace: (): Promise<DirEntry[]> => ipcRenderer.invoke(IPC.WORKSPACE_FLATTEN),
  runCommand: (command: string) => ipcRenderer.invoke(IPC.WORKSPACE_RUN, command),
  // The path is derived here from a real user-supplied File (drag/drop or file
  // picker); the renderer can never pass an arbitrary path string.
  readDroppedFile: (file: File) => {
    const filePath = webUtils.getPathForFile(file);
    if (!filePath) return Promise.reject(new Error('Not a file on disk'));
    return ipcRenderer.invoke(IPC.FILE_READ_ABSOLUTE, filePath);
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  revealInFolder:(relativePath?: string) => ipcRenderer.invoke(IPC.WORKSPACE_REVEAL, relativePath),
  deleteWorkspacePath: (relativePath: string) => ipcRenderer.invoke(IPC.WORKSPACE_DELETE, relativePath),
  createWorkspaceEntry: (relativePath: string, kind: 'file' | 'dir') =>
    ipcRenderer.invoke(IPC.WORKSPACE_CREATE, { relativePath, kind }),
  gitStatus: () => ipcRenderer.invoke(IPC.WORKSPACE_GIT),
  installSkill: () => ipcRenderer.invoke(IPC.SKILL_INSTALL),
  listPlugins: (): Promise<PluginSummary[]> => ipcRenderer.invoke(IPC.PLUGIN_LIST),
  searchMcpCatalog: (query: { search?: string; cursor?: string }): Promise<McpCatalogPage> => ipcRenderer.invoke(IPC.CATALOG_MCP_SEARCH, query),
  listPluginCatalog: (): Promise<PluginCatalog> => ipcRenderer.invoke(IPC.CATALOG_PLUGINS),
  installCatalogPlugin: (id: string): Promise<PluginSummary> => ipcRenderer.invoke(IPC.CATALOG_PLUGIN_INSTALL, id),
  listMcpServers: (): Promise<McpServerEntry[]> => ipcRenderer.invoke(IPC.MCP_LIST),
  saveMcpServers: (entries: McpServerEntry[]): Promise<void> => ipcRenderer.invoke(IPC.MCP_SAVE, entries),
  testMcpServer: (entry: McpServerEntry): Promise<McpTestResult> => ipcRenderer.invoke(IPC.MCP_TEST, entry),
  resetMcpBaseline: (serverName?: string): Promise<void> => ipcRenderer.invoke(IPC.MCP_RESET_BASELINE, serverName),
  listHooks: (): Promise<HookEntry[]> => ipcRenderer.invoke(IPC.HOOKS_LIST),
  saveHooks: (entries: HookEntry[]): Promise<void> => ipcRenderer.invoke(IPC.HOOKS_SAVE, entries),
  installPlugin: (): Promise<PluginSummary | null> => ipcRenderer.invoke(IPC.PLUGIN_INSTALL),
  setPluginEnabled: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke(IPC.PLUGIN_SET_ENABLED, id, enabled),
  uninstallPlugin: (id: string): Promise<void> => ipcRenderer.invoke(IPC.PLUGIN_UNINSTALL, id),
  uninstallSkill: (id: string) => ipcRenderer.invoke(IPC.SKILL_UNINSTALL, id),
  searchSkillHub: (query: SkillHubSearchQuery) => ipcRenderer.invoke(IPC.SKILLHUB_SEARCH, query),
  installSkillHubSkill: (request: SkillHubInstallRequest) => ipcRenderer.invoke(IPC.SKILLHUB_INSTALL, request),
  previewSkillHubSkill: (request: SkillHubInstallRequest) => ipcRenderer.invoke(IPC.SKILLHUB_PREVIEW, request),
  checkNodeEnvironment: (): Promise<NodeEnvStatus> => ipcRenderer.invoke(IPC.NODE_ENV_CHECK),
  exportPdf: (html: string): Promise<string> => ipcRenderer.invoke(IPC.EXPORT_PDF, html),
  getQuickIntegrationsStatus: (): Promise<QuickIntegrationsStatus> => ipcRenderer.invoke(IPC.INTEGRATIONS_STATUS),
  connectNotion: (token: string): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_CONNECT_NOTION, token),
  startGoogleOAuth: (params: GoogleOAuthParams): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_CONNECT_GOOGLE, params),
  connectFeishu: (params: FeishuConnectParams): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_CONNECT_FEISHU, params),
  connectWeCom: (params: WeComConnectParams): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_CONNECT_WECOM, params),
  connectDingTalk: (params: DingTalkConnectParams): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_CONNECT_DINGTALK, params),
  connectYuque: (params: YuqueConnectParams): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_CONNECT_YUQUE, params),
  connectGitee: (params: GiteeConnectParams): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_CONNECT_GITEE, params),
  connectGitHub: (params: GitHubConnectParams): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_CONNECT_GITHUB, params),
  disconnectIntegration: (id: QuickIntegrationId): Promise<IntegrationConnectResult> => ipcRenderer.invoke(IPC.INTEGRATIONS_DISCONNECT, id),
});

