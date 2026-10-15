import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC } from '../shared/constants';
import type {
  DingTalkConnectParams,
  FeishuConnectParams,
  GoogleOAuthParams,
  HookEntry,
  McpServerEntry,
  QuickIntegrationId,
  WeComConnectParams,
  YuqueConnectParams,
} from '../shared/extensionConfig';
import { checkNodeEnvironment, readHookEntries, readMcpEntries, testMcpEntry, writeHookEntries, writeMcpEntries } from './server/plugins/extensionConfig';
import { fetchPluginCatalog, installCatalogPlugin, searchMcpRegistry } from './server/plugins/catalog';
import { installPlugin, listPlugins, setPluginEnabled, syncPluginSkillsDirs, uninstallPlugin } from './server/plugins/pluginStore';
import { resetMcpBaseline } from './server/agent/mcpTools';
import {
  connectDingTalkIntegration,
  connectFeishuIntegration,
  connectNotionIntegration,
  connectWeComIntegration,
  connectYuqueIntegration,
  disconnectQuickIntegration,
  getQuickIntegrationsStatus,
  startGoogleOAuthFlow,
} from './server/auth/quickIntegrations';

/** Extension-pack management. Every change re-syncs the shared skills-dir list so the skills page sees it at once. */
export function registerPluginIpc(dataRoot: string, skillsDirs: string[]): void {
  void syncPluginSkillsDirs(dataRoot, skillsDirs);

  ipcMain.handle(IPC.PLUGIN_LIST, () => listPlugins(dataRoot));

  // Discover catalogs: public read-only sources; installs land disabled.
  ipcMain.handle(IPC.CATALOG_MCP_SEARCH, (_event, query: { search?: string; cursor?: string }) => searchMcpRegistry({ search: query?.search, cursor: query?.cursor }));
  ipcMain.handle(IPC.CATALOG_PLUGINS, () => fetchPluginCatalog());
  ipcMain.handle(IPC.CATALOG_PLUGIN_INSTALL, async (_event, id: string) => {
    const installed = await installCatalogPlugin(dataRoot, String(id));
    await syncPluginSkillsDirs(dataRoot, skillsDirs);
    return installed;
  });

  // User-level MCP servers and hooks (Settings → Extensions). Both are read fresh each turn, so no restart.
  ipcMain.handle(IPC.MCP_LIST, () => readMcpEntries(dataRoot));
  ipcMain.handle(IPC.MCP_SAVE, (_event, entries: McpServerEntry[]) => writeMcpEntries(dataRoot, Array.isArray(entries) ? entries : []));
  ipcMain.handle(IPC.MCP_TEST, (_event, entry: McpServerEntry) => testMcpEntry(dataRoot, entry));
  ipcMain.handle(IPC.MCP_RESET_BASELINE, (_event, serverName?: string) => resetMcpBaseline(dataRoot, typeof serverName === 'string' ? serverName : undefined));
  ipcMain.handle(IPC.HOOKS_LIST, () => readHookEntries(dataRoot));
  ipcMain.handle(IPC.HOOKS_SAVE, (_event, entries: HookEntry[]) => writeHookEntries(dataRoot, Array.isArray(entries) ? entries : []));
  ipcMain.handle(IPC.NODE_ENV_CHECK, () => checkNodeEnvironment());
  ipcMain.handle(IPC.INTEGRATIONS_STATUS, () => getQuickIntegrationsStatus(dataRoot));
  ipcMain.handle(IPC.INTEGRATIONS_CONNECT_NOTION, (_event, token: string) => connectNotionIntegration(dataRoot, String(token || '')));
  ipcMain.handle(IPC.INTEGRATIONS_CONNECT_GOOGLE, (_event, params: GoogleOAuthParams) => startGoogleOAuthFlow(dataRoot, params));
  ipcMain.handle(IPC.INTEGRATIONS_CONNECT_FEISHU, (_event, params: FeishuConnectParams) => connectFeishuIntegration(dataRoot, params));
  ipcMain.handle(IPC.INTEGRATIONS_CONNECT_WECOM, (_event, params: WeComConnectParams) => connectWeComIntegration(dataRoot, params));
  ipcMain.handle(IPC.INTEGRATIONS_CONNECT_DINGTALK, (_event, params: DingTalkConnectParams) => connectDingTalkIntegration(dataRoot, params));
  ipcMain.handle(IPC.INTEGRATIONS_CONNECT_YUQUE, (_event, params: YuqueConnectParams) => connectYuqueIntegration(dataRoot, params));
  ipcMain.handle(IPC.INTEGRATIONS_DISCONNECT, (_event, id: QuickIntegrationId) => disconnectQuickIntegration(dataRoot, id));

  ipcMain.handle(IPC.PLUGIN_INSTALL, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择扩展包文件夹' });
    if (result.canceled || !result.filePaths[0]) return null;
    const installed = await installPlugin(dataRoot, result.filePaths[0]);
    await syncPluginSkillsDirs(dataRoot, skillsDirs);
    return installed;
  });

  ipcMain.handle(IPC.PLUGIN_SET_ENABLED, async (_event, id: string, enabled: boolean) => {
    await setPluginEnabled(dataRoot, id, enabled === true);
    await syncPluginSkillsDirs(dataRoot, skillsDirs);
  });

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_event, id: string) => {
    await uninstallPlugin(dataRoot, id);
    await syncPluginSkillsDirs(dataRoot, skillsDirs);
  });
}
