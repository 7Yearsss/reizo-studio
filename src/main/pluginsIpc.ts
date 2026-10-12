import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC } from '../shared/constants';
import { installPlugin, listPlugins, setPluginEnabled, syncPluginSkillsDirs, uninstallPlugin } from './server/plugins/pluginStore';

/** Extension-pack management. Every change re-syncs the shared skills-dir list so the skills page sees it at once. */
export function registerPluginIpc(dataRoot: string, skillsDirs: string[]): void {
  void syncPluginSkillsDirs(dataRoot, skillsDirs);

  ipcMain.handle(IPC.PLUGIN_LIST, () => listPlugins(dataRoot));

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
