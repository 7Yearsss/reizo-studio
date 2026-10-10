import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
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

  // Reads a file the user dropped/picked. The preload derives `filePath` from a
  // real File object, so the renderer cannot name arbitrary paths; the sender
  // check below also rejects calls from any frame that is not the app's own page.
  ipcMain.handle(IPC.FILE_READ_ABSOLUTE, async (event, filePath: string) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error('Untrusted sender');
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('absolute path is required');
    if (!(await stat(filePath)).isFile()) throw new Error('Not a regular file');
    const handle = await open(filePath, 'r');
    let buf: Buffer;
    let truncated: boolean;
    try {
      const probe = Buffer.alloc(DROPPED_FILE_MAX_BYTES + 1);
      const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
      truncated = bytesRead > DROPPED_FILE_MAX_BYTES;
      buf = probe.subarray(0, Math.min(bytesRead, DROPPED_FILE_MAX_BYTES));
    } finally {
      await handle.close();
    }
    if (buf.includes(0)) throw new Error('Binary file');
    return {
      name: path.basename(filePath),
      content: buf.toString('utf8'),
      truncated,
    };
  });
}

function isTrustedSender(url: string | undefined): boolean {
  if (!url) return false;
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return new URL(url).origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
  }
  return url.startsWith('file://');
}
