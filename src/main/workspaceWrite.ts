import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WRITE_FILE_MAX_BYTES } from '../shared/constants';
import { resolveInsideWorkspace, toWorkspaceRelative } from './workspacePath';

export async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<{ path: string; bytes: number; before: string }> {
  if (Buffer.byteLength(content, 'utf8') > WRITE_FILE_MAX_BYTES) {
    throw new Error(`File exceeds ${WRITE_FILE_MAX_BYTES} byte write limit`);
  }
  const abs = resolveInsideWorkspace(workspaceRoot, relativePath);
  const before = await readFile(abs, 'utf8').catch(() => '');
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  return { path: toWorkspaceRelative(workspaceRoot, abs), bytes: Buffer.byteLength(content, 'utf8'), before };
}

/** Read a workspace file for a diff preview; missing file reads as empty. */
export async function readWorkspaceFileOrEmpty(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const abs = resolveInsideWorkspace(workspaceRoot, relativePath);
  return readFile(abs, 'utf8').catch(() => '');
}

export async function editWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<{ path: string; replacements: number; before: string; after: string }> {
  if (!oldString) throw new Error('oldString is required');
  const abs = resolveInsideWorkspace(workspaceRoot, relativePath);
  const before = await readFile(abs, 'utf8');
  const count = before.split(oldString).length - 1;
  if (count === 0) throw new Error('oldString was not found in the file');
  const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
  if (Buffer.byteLength(after, 'utf8') > WRITE_FILE_MAX_BYTES) {
    throw new Error(`File exceeds ${WRITE_FILE_MAX_BYTES} byte write limit`);
  }
  await writeFile(abs, after, 'utf8');
  return {
    path: toWorkspaceRelative(workspaceRoot, abs),
    replacements: replaceAll ? count : 1,
    before,
    after,
  };
}

export async function deleteWorkspacePath(workspaceRoot: string, relativePath: string): Promise<{ path: string }> {
  const abs = resolveInsideWorkspace(workspaceRoot, relativePath);
  if (abs === path.resolve(workspaceRoot)) throw new Error('Cannot delete the workspace root');
  await rm(abs, { recursive: true, force: true });
  return { path: toWorkspaceRelative(workspaceRoot, abs) };
}

export async function createWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
  kind: 'file' | 'dir',
): Promise<{ path: string; kind: 'file' | 'dir' }> {
  const abs = resolveInsideWorkspace(workspaceRoot, relativePath);
  if (kind === 'dir') await mkdir(abs, { recursive: true });
  else {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, '', 'utf8');
  }
  return { path: toWorkspaceRelative(workspaceRoot, abs), kind };
}

export function previewDiff(before: string, after: string, maxLines = 80): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines: string[] = [];
  const len = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < len; i += 1) {
    const a = beforeLines[i];
    const b = afterLines[i];
    if (a === b) continue;
    if (a !== undefined) lines.push(`- ${a}`);
    if (b !== undefined) lines.push(`+ ${b}`);
    if (lines.length >= maxLines) {
      lines.push('…');
      break;
    }
  }
  return lines.join('\n') || '(no line-level diff)';
}
