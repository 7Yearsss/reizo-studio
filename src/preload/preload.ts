import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/constants';
import type { DirEntry } from '../shared/workspace';

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
  readDroppedFile: (filePath: string) => ipcRenderer.invoke(IPC.FILE_READ_ABSOLUTE, filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  revealInFolder: (relativePath?: string) => ipcRenderer.invoke(IPC.WORKSPACE_REVEAL, relativePath),
  deleteWorkspacePath: (relativePath: string) => ipcRenderer.invoke(IPC.WORKSPACE_DELETE, relativePath),
  createWorkspaceEntry: (relativePath: string, kind: 'file' | 'dir') =>
    ipcRenderer.invoke(IPC.WORKSPACE_CREATE, { relativePath, kind }),
  gitStatus: () => ipcRenderer.invoke(IPC.WORKSPACE_GIT),
  installSkill: () => ipcRenderer.invoke(IPC.SKILL_INSTALL),
  uninstallSkill: (id: string) => ipcRenderer.invoke(IPC.SKILL_UNINSTALL, id),
});
