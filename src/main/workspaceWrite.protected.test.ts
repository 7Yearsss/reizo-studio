import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editWorkspaceFile, setWriteProtectedRoots, writeWorkspaceFile } from './workspaceWrite';

describe('write protection for the app data folder', () => {
  let workspace = '';
  afterEach(async () => {
    setWriteProtectedRoots([]);
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('a workspace that contains the data folder cannot write or edit inside it, but its other files still work', async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'reizo-protect-'));
    const data = path.join(workspace, 'AppData', 'data');
    await mkdir(data, { recursive: true });
    await writeFile(path.join(data, 'providers.json'), '{"key":"secret"}');
    setWriteProtectedRoots([data]);

    await expect(writeWorkspaceFile(workspace, 'AppData/data/providers.json', '{}')).rejects.toThrow('应用自身的数据');
    await expect(writeWorkspaceFile(workspace, 'AppData/data/new.json', '{}')).rejects.toThrow('应用自身的数据');
    await expect(editWorkspaceFile(workspace, 'AppData/data/providers.json', 'secret', 'x')).rejects.toThrow('应用自身的数据');
    expect(await readFile(path.join(data, 'providers.json'), 'utf8')).toBe('{"key":"secret"}');

    await writeWorkspaceFile(workspace, 'notes.md', 'ok');
    expect(await readFile(path.join(workspace, 'notes.md'), 'utf8')).toBe('ok');
  });
});
