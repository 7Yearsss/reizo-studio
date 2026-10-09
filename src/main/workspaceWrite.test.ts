import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspaceEntry, deleteWorkspacePath, editWorkspaceFile, readWorkspaceFileSnapshot, writeWorkspaceFile } from './workspaceWrite';
import { readWorkspaceText } from './workspaceFs';

describe('editWorkspaceFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'reizo-test-write-'));
  });

  afterEach(async () => {
    if (path.dirname(path.resolve(tempDir)) !== path.resolve(tmpdir()) || !path.basename(tempDir).startsWith('reizo-test-write-')) throw new Error('Unexpected fixture cleanup path');
    await rm(tempDir, { recursive: true, force: true });
  });

  it('replaces single occurrence successfully', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    await writeFile(filePath, 'hello world\nwelcome', 'utf8');

    const result = await editWorkspaceFile(tempDir, 'test.txt', 'world', 'there');
    expect(result.replacements).toBe(1);
    expect(result.after).toBe('hello there\nwelcome');

    const onDisk = await readFile(filePath, 'utf8');
    expect(onDisk).toBe('hello there\nwelcome');
  });

  it('throws error when oldString is not found', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    await writeFile(filePath, 'hello world', 'utf8');

    await expect(
      editWorkspaceFile(tempDir, 'test.txt', 'not-here', 'replacement'),
    ).rejects.toThrow('oldString was not found in the file');
  });

  it('throws error when multiple occurrences exist and replaceAll is false', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    await writeFile(filePath, 'foo bar foo baz foo', 'utf8');

    await expect(
      editWorkspaceFile(tempDir, 'test.txt', 'foo', 'qux', false),
    ).rejects.toThrow(/Found 3 occurrences of oldString.*uniquely match/);

    // File on disk must remain untouched
    const onDisk = await readFile(filePath, 'utf8');
    expect(onDisk).toBe('foo bar foo baz foo');
  });

  it('replaces all occurrences when replaceAll is true', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    await writeFile(filePath, 'foo bar foo baz foo', 'utf8');

    const result = await editWorkspaceFile(tempDir, 'test.txt', 'foo', 'qux', true);
    expect(result.replacements).toBe(3);
    expect(result.after).toBe('qux bar qux baz qux');

    const onDisk = await readFile(filePath, 'utf8');
    expect(onDisk).toBe('qux bar qux baz qux');
  });

  it('rejects read, write, edit and create through a junction outside the bound workspace', async () => {
    const workspace = path.join(tempDir, 'workspace');
    const external = path.join(tempDir, 'external');
    await Promise.all([mkdir(workspace), mkdir(external)]);
    await writeFile(path.join(external, 'protected.txt'), 'preserve this content');
    await symlink(external, path.join(workspace, 'linked'), 'junction');
    await expect(readWorkspaceText(workspace, 'linked/protected.txt')).rejects.toThrow('filesystem link');
    await expect(writeWorkspaceFile(workspace, 'linked/new.txt', 'new content')).rejects.toThrow('filesystem link');
    await expect(editWorkspaceFile(workspace, 'linked/protected.txt', 'preserve', 'replace')).rejects.toThrow('filesystem link');
    await expect(createWorkspaceEntry(workspace, 'linked/nested/new.txt', 'file')).rejects.toThrow('filesystem link');
    expect(await readFile(path.join(external, 'protected.txt'), 'utf8')).toBe('preserve this content');
    await expect(readFile(path.join(external, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    const inside = path.join(workspace, 'inside'); await mkdir(inside);
    await writeFile(path.join(inside, 'keep.txt'), 'keep target');
    await symlink(inside, path.join(workspace, 'inside-alias'), 'junction');
    await deleteWorkspacePath(workspace, 'inside-alias');
    expect(await readFile(path.join(inside, 'keep.txt'), 'utf8')).toBe('keep target');
  });

  it('creates new files exclusively and preserves an existing file', async () => {
    await writeFile(path.join(tempDir, 'existing.txt'), 'preserve this content');
    await expect(createWorkspaceEntry(tempDir, 'existing.txt', 'file')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path.join(tempDir, 'existing.txt'), 'utf8')).toBe('preserve this content');
    await createWorkspaceEntry(tempDir, 'nested/new.txt', 'file');
    expect(await readFile(path.join(tempDir, 'nested/new.txt'), 'utf8')).toBe('');
  });

  it('refuses writes and edits when the approved snapshot changed, including an intervening creation', async () => {
    await writeFile(path.join(tempDir, 'reviewed.txt'), 'reviewed version');
    const approved = await readWorkspaceFileSnapshot(tempDir, 'reviewed.txt');
    await writeFile(path.join(tempDir, 'reviewed.txt'), 'external editor version');
    await expect(writeWorkspaceFile(tempDir, 'reviewed.txt', 'proposed overwrite', approved)).rejects.toThrow('审批后发生变化');
    await expect(editWorkspaceFile(tempDir, 'reviewed.txt', 'external', 'proposed', false, approved)).rejects.toThrow('审批后发生变化');
    expect(await readFile(path.join(tempDir, 'reviewed.txt'), 'utf8')).toBe('external editor version');
    const missing = await readWorkspaceFileSnapshot(tempDir, 'new.txt');
    await writeFile(path.join(tempDir, 'new.txt'), 'intervening creation');
    await expect(writeWorkspaceFile(tempDir, 'new.txt', 'proposed', missing)).rejects.toThrow('审批后发生变化');
    expect(await readFile(path.join(tempDir, 'new.txt'), 'utf8')).toBe('intervening creation');
    const current = await readWorkspaceFileSnapshot(tempDir, 'reviewed.txt');
    await writeWorkspaceFile(tempDir, 'reviewed.txt', 'approved replacement', current);
    expect(await readFile(path.join(tempDir, 'reviewed.txt'), 'utf8')).toBe('approved replacement');
  });
});
