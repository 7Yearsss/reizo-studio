import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editWorkspaceFile } from './workspaceWrite';

describe('editWorkspaceFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'reizo-test-write-'));
  });

  afterEach(async () => {
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
});
