import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { DROPPED_FILE_MAX_BYTES, IPC } from '../shared/constants';
import type { SettingsStore } from './server/storage/settingsStore';
import { flattenWorkspace, listWorkspaceDir, readWorkspaceText } from './workspaceFs';
import { readGitStatus } from './workspaceGit';
import { runWorkspaceCommand } from './workspaceShell';
import { createWorkspaceEntry, deleteWorkspacePath } from './workspaceWrite';
import { resolveInsideWorkspace } from './workspacePath';

async function requireWorkspace(settingsStore: SettingsStore): Promise<string> {
  const { workspacePath } = await settingsStore.get();
  if (!workspacePath) throw new Error('No workspace is bound');
  return workspacePath;
}

export function registerWorkspaceIpc(settingsStore: SettingsStore): void {
  ipcMain.handle(IPC.WORKSPACE_PICK, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.WORKSPACE_LIST, async (_event, relativePath?: string) => {
    const root = await requireWorkspace(settingsStore);
    return listWorkspaceDir(root, typeof relativePath === 'string' ? relativePath : '');
  });

  ipcMain.handle(IPC.WORKSPACE_READ, async (_event, relativePath: string) => {
    if (typeof relativePath !== 'string' || !relativePath) throw new Error('path is required');
    const root = await requireWorkspace(settingsStore);
    return readWorkspaceText(root, relativePath);
  });

  ipcMain.handle(IPC.WORKSPACE_FLATTEN, async () => {
    const root = await requireWorkspace(settingsStore);
    return flattenWorkspace(root);
  });

  ipcMain.handle(IPC.WORKSPACE_RUN, async (_event, command: string) => {
    if (typeof command !== 'string' || !command.trim()) throw new Error('command is required');
    const root = await requireWorkspace(settingsStore);
    return runWorkspaceCommand(root, command);
  });

  ipcMain.handle(IPC.WORKSPACE_REVEAL, async (_event, relativePath?: string) => {
    const root = await requireWorkspace(settingsStore);
    if (!relativePath) {
      await shell.openPath(root);
      return;
    }
    const abs = resolveInsideWorkspace(root, relativePath);
    shell.showItemInFolder(abs);
  });

  ipcMain.handle(IPC.WORKSPACE_DELETE, async (_event, relativePath: string) => {
    if (typeof relativePath !== 'string' || !relativePath) throw new Error('path is required');
    const root = await requireWorkspace(settingsStore);
    return deleteWorkspacePath(root, relativePath);
  });

  ipcMain.handle(IPC.WORKSPACE_CREATE, async (_event, payload: { relativePath: string; kind: 'file' | 'dir' }) => {
    if (!payload?.relativePath) throw new Error('path is required');
    const kind = payload.kind === 'dir' ? 'dir' : 'file';
    const root = await requireWorkspace(settingsStore);
    return createWorkspaceEntry(root, payload.relativePath, kind);
  });

  ipcMain.handle(IPC.WORKSPACE_GIT, async () => {
    const root = await requireWorkspace(settingsStore);
    return readGitStatus(root);
  });

  ipcMain.handle(IPC.FILE_READ_ABSOLUTE, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('path is required');
    const buf = await readFile(filePath);
    if (buf.includes(0)) throw new Error('Binary file');
    const truncated = buf.byteLength > DROPPED_FILE_MAX_BYTES;
    return {
      name: filePath.split(/[/\\]/).pop() ?? 'file',
      content: (truncated ? buf.subarray(0, DROPPED_FILE_MAX_BYTES) : buf).toString('utf8'),
      truncated,
    };
  });
}
