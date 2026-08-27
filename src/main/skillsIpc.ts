import { BrowserWindow, dialog, ipcMain } from 'electron';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { IPC } from '../shared/constants';
import { loadSkills } from './skills';

export function registerSkillIpc(userSkillsDir: string): void {
  ipcMain.handle(IPC.SKILL_INSTALL, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Skill', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const base = path.basename(source, '.md').toLowerCase() === 'skill'
      ? path.basename(path.dirname(source))
      : path.basename(source, '.md');
    const destDir = path.join(userSkillsDir, base);
    await mkdir(destDir, { recursive: true });
    await cp(source, path.join(destDir, 'SKILL.md'));
    return { id: base };
  });

  ipcMain.handle(IPC.SKILL_UNINSTALL, async (_event, id: string) => {
    if (typeof id !== 'string' || !id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new Error('Invalid skill id');
    }
    await rm(path.join(userSkillsDir, id), { recursive: true, force: true });
  });
}

export async function listUserAndBundled(dirs: string[]) {
  return loadSkills(dirs);
}
