import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC } from '../shared/constants';
import type { HookEntry, McpServerEntry } from '../shared/extensionConfig';
import { readHookEntries, readMcpEntries, testMcpEntry, writeHookEntries, writeMcpEntries } from './server/plugins/extensionConfig';
import { installPlugin, listPlugins, setPluginEnabled, syncPluginSkillsDirs, uninstallPlugin } from './server/plugins/pluginStore';

/** Extension-pack management. Every change re-syncs the shared skills-dir list so the skills page sees it at once. */
export function registerPluginIpc(dataRoot: string, skillsDirs: string[]): void {
  void syncPluginSkillsDirs(dataRoot, skillsDirs);

  ipcMain.handle(IPC.PLUGIN_LIST, () => listPlugins(dataRoot));

  // User-level MCP servers and hooks (Settings → Extensions). Both are read fresh each turn, so no restart.
  ipcMain.handle(IPC.MCP_LIST, () => readMcpEntries(dataRoot));
  ipcMain.handle(IPC.MCP_SAVE, (_event, entries: McpServerEntry[]) => writeMcpEntries(dataRoot, Array.isArray(entries) ? entries : []));
  ipcMain.handle(IPC.MCP_TEST, (_event, entry: McpServerEntry) => testMcpEntry(dataRoot, entry));
  ipcMain.handle(IPC.HOOKS_LIST, () => readHookEntries(dataRoot));
  ipcMain.handle(IPC.HOOKS_SAVE, (_event, entries: HookEntry[]) => writeHookEntries(dataRoot, Array.isArray(entries) ? entries : []));

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
