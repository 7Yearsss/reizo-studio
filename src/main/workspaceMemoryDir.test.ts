import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  deleteMemoryEntry,
  listMemoryManifest,
  memoryFileNameFor,
  normalizeMemoryType,
  readMemoryEntry,
  writeMemoryEntry,
} from './workspaceMemoryDir';

describe('workspaceMemoryDir', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'reizo-test-memory-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes an entry as memory/<slug>.md with frontmatter and indexes it', async () => {
    const result = await writeMemoryEntry(root, {
      name: 'Prefers Minimal UI',
      description: 'User likes quiet, minimal interfaces',
      type: 'user',
      body: 'Keep UI text short.',
    });
    expect(result.fileName).toBe('prefers-minimal-ui.md');

    const raw = await readFile(path.join(root, 'memory', 'prefers-minimal-ui.md'), 'utf8');
    expect(raw).toContain('name: Prefers Minimal UI');
    expect(raw).toContain('type: user');
    expect(raw).toContain('Keep UI text short.');

    const index = await readFile(path.join(root, 'MEMORY.md'), 'utf8');
    expect(index).toContain('- [Prefers Minimal UI](memory/prefers-minimal-ui.md) — User likes quiet');
  });

  it('same name overwrites in place; manifest reflects it once', async () => {
    await writeMemoryEntry(root, { name: 'a', description: 'd1', type: 'project', body: 'v1' });
    await writeMemoryEntry(root, { name: 'a', description: 'd2', type: 'project', body: 'v2' });
    const manifest = await listMemoryManifest(root);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].description).toBe('d2');
  });

  it('delete removes the file and drops the index line', async () => {
    await writeMemoryEntry(root, { name: 'gone', description: 'd', type: 'project', body: 'x' });
    await deleteMemoryEntry(root, 'gone.md');
    expect(await listMemoryManifest(root)).toHaveLength(0);
    const index = await readFile(path.join(root, 'MEMORY.md'), 'utf8');
    expect(index).not.toContain('gone.md');
  });

  it('readMemoryEntry round-trips frontmatter + body', async () => {
    await writeMemoryEntry(root, {
      name: 'feedback-1',
      description: 'why',
      type: 'feedback',
      body: 'Always confirm before deleting.',
    });
    const entry = await readMemoryEntry(root, 'feedback-1.md');
    expect(entry?.type).toBe('feedback');
    expect(entry?.body).toBe('Always confirm before deleting.');
  });

  it('preserves non-index lines in MEMORY.md when rebuilding', async () => {
    await writeFile(path.join(root, 'MEMORY.md'), '# Memory\n\n- [old](memory/old.md) — stale\n\nPinned note stays.\n');
    await mkdir(path.join(root, 'memory'), { recursive: true });
    await writeMemoryEntry(root, { name: 'new', description: 'd', type: 'project', body: 'b' });
    const index = await readFile(path.join(root, 'MEMORY.md'), 'utf8');
    expect(index).toContain('Pinned note stays.');
    expect(index).toContain('memory/new.md');
    expect(index).not.toContain('memory/old.md');
  });

  it('rejects path traversal in read/delete', async () => {
    expect(await readMemoryEntry(root, '../secret.md')).toBeNull();
    await expect(deleteMemoryEntry(root, '../MEMORY.md')).resolves.toBeUndefined();
  });

  it('memoryFileNameFor slugifies and normalizeMemoryType validates', () => {
    expect(memoryFileNameFor('Brand Colors!')).toBe('brand-colors.md');
    expect(memoryFileNameFor('')).toBe('memory.md');
    expect(normalizeMemoryType('user')).toBe('user');
    expect(normalizeMemoryType('bogus')).toBe('project');
  });

  it('empty workspace returns empty manifest', async () => {
    expect(await listMemoryManifest(root)).toEqual([]);
  });
});
