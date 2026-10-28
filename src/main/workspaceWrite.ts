import { lstat, mkdir, open, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { linkSync, readFileSync, realpathSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { WRITE_FILE_MAX_BYTES } from '../shared/constants';
import { resolveInsideWorkspace, toWorkspaceRelative } from './workspacePath';
import { isProtectedPath, PROTECTED_WRITE_MESSAGE } from '../shared/protectedPaths';

let protectedRoots: string[] = [];
/** Folders agent write tools must never touch (the app's own data). Set once at startup. */
export function setWriteProtectedRoots(roots: string[]): void {
  protectedRoots = roots.filter(Boolean).flatMap(root => {
    const absolute = path.resolve(root);
    // Windows short names and filesystem aliases must match the canonical write target too.
    try { return [absolute, realpathSync.native(absolute)]; } catch { return [absolute]; }
  });
}
function assertWritable(absolute: string): void {
  if (isProtectedPath(absolute, protectedRoots)) throw new Error(PROTECTED_WRITE_MESSAGE);
}
import { serializeFileMutation } from './server/storage/atomicFile';

export interface WorkspaceFileVersion { expectedHash: string | null; expectedPath: string }
export interface WorkspaceFileSnapshot extends WorkspaceFileVersion { content: string; mode?: number }
export class WorkspaceConflictError extends Error {
  readonly code = 'WORKSPACE_CONFLICT';
  constructor() { super('文件在预览或审批后发生变化，请重新读取并重新审批；本次未写入'); this.name = 'WorkspaceConflictError'; }
}
const hash = (content: Buffer) => createHash('sha256').update(content).digest('hex');
function checkVersion(snapshot: WorkspaceFileVersion, expected?: WorkspaceFileVersion): void {
  if (expected && (expected.expectedHash !== snapshot.expectedHash || expected.expectedPath !== snapshot.expectedPath)) throw new WorkspaceConflictError();
}

export async function readWorkspaceFileSnapshot(workspaceRoot: string, relativePath: string): Promise<WorkspaceFileSnapshot> {
  const absolute = resolveInsideWorkspace(workspaceRoot, relativePath);
  try {
    const content = await readFile(absolute);
    if (content.includes(0)) throw new Error('工作区文本工具不能覆盖二进制文件');
    if (!Buffer.from(content.toString('utf8'), 'utf8').equals(content)) throw new Error('工作区文本工具仅支持有效 UTF-8 文本，本次未写入');
    const info = await stat(absolute);
    if (resolveInsideWorkspace(workspaceRoot, relativePath) !== absolute) throw new WorkspaceConflictError();
    return { content: content.toString('utf8'), expectedHash: hash(content), expectedPath: absolute, mode: info.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (resolveInsideWorkspace(workspaceRoot, relativePath) !== absolute) throw new WorkspaceConflictError();
    return { content: '', expectedHash: null, expectedPath: absolute };
  }
}

/** The final check and publication do not yield; strict cross-process CAS still needs an OS lock. */
async function publishWorkspaceText(workspaceRoot: string, relativePath: string, content: string, expected: WorkspaceFileSnapshot): Promise<void> {
  if (Buffer.byteLength(content, 'utf8') > WRITE_FILE_MAX_BYTES) throw new Error(`File exceeds ${WRITE_FILE_MAX_BYTES} byte write limit`);
  const absolute = resolveInsideWorkspace(workspaceRoot, relativePath);
  if (absolute !== expected.expectedPath) throw new WorkspaceConflictError();
  await mkdir(path.dirname(absolute), { recursive: true });
  if (resolveInsideWorkspace(workspaceRoot, relativePath) !== absolute) throw new WorkspaceConflictError();
  const temporary = path.join(path.dirname(absolute), `.reizo-write-${nanoid()}.tmp`);
  const handle = await open(temporary, 'wx', expected.mode ?? 0o666);
  try {
    try { await handle.writeFile(content, 'utf8'); if (expected.mode !== undefined) await handle.chmod(expected.mode); await handle.sync(); }
    finally { await handle.close(); }
    const target = resolveInsideWorkspace(workspaceRoot, relativePath);
    let currentHash: string | null;
    try { currentHash = hash(readFileSync(target)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; currentHash = null; }
    checkVersion({ expectedHash: currentHash, expectedPath: target }, expected);
    if (expected.expectedHash === null) {
      try { linkSync(temporary, absolute); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkspaceConflictError(); throw error; }
    } else renameSync(temporary, absolute);
  } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
  expected?: WorkspaceFileVersion,
): Promise<{ path: string; bytes: number; before: string }> {
  if (Buffer.byteLength(content, 'utf8') > WRITE_FILE_MAX_BYTES) {
    throw new Error(`File exceeds ${WRITE_FILE_MAX_BYTES} byte write limit`);
  }
  const absolute = resolveInsideWorkspace(workspaceRoot, relativePath);
  assertWritable(absolute);
  return serializeFileMutation(absolute, async () => {
    const snapshot = await readWorkspaceFileSnapshot(workspaceRoot, relativePath);
    checkVersion(snapshot, expected);
    await publishWorkspaceText(workspaceRoot, relativePath, content, snapshot);
    return { path: toWorkspaceRelative(workspaceRoot, absolute), bytes: Buffer.byteLength(content, 'utf8'), before: snapshot.content };
  });
}

/** Read a workspace file for a diff preview; missing file reads as empty. */
export async function readWorkspaceFileOrEmpty(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  return (await readWorkspaceFileSnapshot(workspaceRoot, relativePath)).content;
}

export async function editWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  oldString: string,
  newString: string,
  replaceAll = false,
  expected?: WorkspaceFileVersion,
): Promise<{ path: string; replacements: number; before: string; after: string }> {
  if (!oldString) throw new Error('oldString is required');
  const absolute = resolveInsideWorkspace(workspaceRoot, relativePath);
  assertWritable(absolute);
  return serializeFileMutation(absolute, async () => {
  const snapshot = await readWorkspaceFileSnapshot(workspaceRoot, relativePath);
  checkVersion(snapshot, expected);
  if (snapshot.expectedHash === null) throw new Error('文件不存在，无法编辑');
  const before = snapshot.content;
  const count = before.split(oldString).length - 1;
  if (count === 0) throw new Error('oldString was not found in the file');
  if (count > 1 && !replaceAll) {
    throw new Error(
      `Found ${count} occurrences of oldString. oldString must uniquely match exactly one block of text, or set replaceAll to true. Include more surrounding lines in oldString to make it unique.`,
    );
  }
  const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
  if (Buffer.byteLength(after, 'utf8') > WRITE_FILE_MAX_BYTES) {
    throw new Error(`File exceeds ${WRITE_FILE_MAX_BYTES} byte write limit`);
  }
  await publishWorkspaceText(workspaceRoot, relativePath, after, snapshot);
  return {
    path: toWorkspaceRelative(workspaceRoot, absolute),
    replacements: replaceAll ? count : 1,
    before,
    after,
  };
  });
}

export async function deleteWorkspacePath(workspaceRoot: string, relativePath: string): Promise<{ path: string }> {
  const abs = resolveInsideWorkspace(workspaceRoot, relativePath);
  if (abs === resolveInsideWorkspace(workspaceRoot, '.')) throw new Error('Cannot delete the workspace root');
  const requested = path.resolve(workspaceRoot, relativePath);
  if ((await lstat(requested).catch((error: NodeJS.ErrnoException): null => { if (error.code === 'ENOENT') return null; throw error; }))?.isSymbolicLink()) {
    await unlink(requested);
    return { path: toWorkspaceRelative(workspaceRoot, requested) };
  }
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
    await writeFile(abs, '', { encoding: 'utf8', flag: 'wx' });
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
