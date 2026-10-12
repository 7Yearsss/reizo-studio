import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/constants';
import type { DirEntry } from '../shared/workspace';
import type { SkillHubInstallRequest, SkillHubSearchQuery } from '../shared/skillhub';
import type { PluginSummary } from '../shared/plugins';
import type { HookEntry, McpServerEntry, McpTestResult } from '../shared/extensionConfig';

contextBridge.exposeInMainWorld('reizo', {
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
  revealInFolder: (relativePath?: string) => ipcRenderer.invoke(IPC.WORKSPACE_REVEAL, relativePath),
  deleteWorkspacePath: (relativePath: string) => ipcRenderer.invoke(IPC.WORKSPACE_DELETE, relativePath),
  createWorkspaceEntry: (relativePath: string, kind: 'file' | 'dir') =>
    ipcRenderer.invoke(IPC.WORKSPACE_CREATE, { relativePath, kind }),
  gitStatus: () => ipcRenderer.invoke(IPC.WORKSPACE_GIT),
  installSkill: () => ipcRenderer.invoke(IPC.SKILL_INSTALL),
  listPlugins: (): Promise<PluginSummary[]> => ipcRenderer.invoke(IPC.PLUGIN_LIST),
  listMcpServers: (): Promise<McpServerEntry[]> => ipcRenderer.invoke(IPC.MCP_LIST),
  saveMcpServers: (entries: McpServerEntry[]): Promise<void> => ipcRenderer.invoke(IPC.MCP_SAVE, entries),
  testMcpServer: (entry: McpServerEntry): Promise<McpTestResult> => ipcRenderer.invoke(IPC.MCP_TEST, entry),
  listHooks: (): Promise<HookEntry[]> => ipcRenderer.invoke(IPC.HOOKS_LIST),
  saveHooks: (entries: HookEntry[]): Promise<void> => ipcRenderer.invoke(IPC.HOOKS_SAVE, entries),
  installPlugin: (): Promise<PluginSummary | null> => ipcRenderer.invoke(IPC.PLUGIN_INSTALL),
  setPluginEnabled: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke(IPC.PLUGIN_SET_ENABLED, id, enabled),
  uninstallPlugin: (id: string): Promise<void> => ipcRenderer.invoke(IPC.PLUGIN_UNINSTALL, id),
  uninstallSkill: (id: string) => ipcRenderer.invoke(IPC.SKILL_UNINSTALL, id),
  searchSkillHub: (query: SkillHubSearchQuery) => ipcRenderer.invoke(IPC.SKILLHUB_SEARCH, query),
  installSkillHubSkill: (request: SkillHubInstallRequest) => ipcRenderer.invoke(IPC.SKILLHUB_INSTALL, request),
  previewSkillHubSkill: (request: SkillHubInstallRequest) => ipcRenderer.invoke(IPC.SKILLHUB_PREVIEW, request),
  exportPdf: (html: string): Promise<string> => ipcRenderer.invoke(IPC.EXPORT_PDF, html),
});
