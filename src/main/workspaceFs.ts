import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  READ_FILE_PREVIEW_MAX_BYTES,
  WORKSPACE_FLATTEN_MAX_DEPTH,
  WORKSPACE_FLATTEN_MAX_ENTRIES,
  WORKSPACE_LIST_MAX_ENTRIES,
} from '../shared/constants';
import { IGNORED_DIR_NAMES, resolveInsideWorkspace, toWorkspaceRelative } from './workspacePath';
import type { DirEntry } from '../shared/workspace';

export type { DirEntry };

export async function listWorkspaceDir(workspaceRoot: string, relativePath = ''): Promise<DirEntry[]> {
  const abs = resolveInsideWorkspace(workspaceRoot, relativePath);
  const entries = await readdir(abs, { withFileTypes: true });
  const mapped: DirEntry[] = [];
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry.name) || entry.name.startsWith('.$')) continue;
    const kind = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : null;
    if (!kind) continue;
    mapped.push({
      name: entry.name,
      relativePath: toWorkspaceRelative(workspaceRoot, path.join(abs, entry.name)),
      kind,
    });
    if (mapped.length >= WORKSPACE_LIST_MAX_ENTRIES) break;
  }
  return mapped.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

const BINARY_MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.tiff', '.tif', '.svgz', '.psd',
  '.mp4', '.mov', '.webm', '.avi', '.mkv',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac',
  '.zip', '.gz', '.tar', '.7z', '.rar', '.pdf',
]);

export const BINARY_MEDIA_READ_ERROR =
  'Cannot read binary media file: read_file only supports UTF-8 text files. ' +
  'Canvas and image outputs are rendered directly on the user interface; ' +
  'do not attempt to read or convert binary files.';

export function binaryReadErrorMessage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_MEDIA_EXTENSIONS.has(ext)) return BINARY_MEDIA_READ_ERROR;
  return 'Binary file: read_file only supports UTF-8 text files. Do not attempt to read or convert binary files.';
}

export async function readWorkspaceText(
  workspaceRoot: string,
  relativePath: string,
  maxBytes = READ_FILE_PREVIEW_MAX_BYTES,
): Promise<{ relativePath: string; content: string; truncated: boolean }> {
  const abs = resolveInsideWorkspace(workspaceRoot, relativePath);
  const info = await stat(abs);
  if (!info.isFile()) throw new Error('Not a file');
  const buf = await readFile(abs);
  if (buf.includes(0)) throw new Error(binaryReadErrorMessage(abs));
  const truncated = buf.byteLength > maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;
  return {
    relativePath: toWorkspaceRelative(workspaceRoot, abs),
    content: slice.toString('utf8'),
    truncated,
  };
}

export async function flattenWorkspace(
  workspaceRoot: string,
  maxDepth = WORKSPACE_FLATTEN_MAX_DEPTH,
  maxEntries = WORKSPACE_FLATTEN_MAX_ENTRIES,
): Promise<DirEntry[]> {
  const out: DirEntry[] = [];

  async function walk(relativePath: string, depth: number): Promise<void> {
    if (out.length >= maxEntries || depth > maxDepth) return;
    let entries: DirEntry[];
    try {
      entries = await listWorkspaceDir(workspaceRoot, relativePath);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxEntries) return;
      out.push(entry);
      if (entry.kind === 'dir') await walk(entry.relativePath, depth + 1);
    }
  }

  await walk('', 0);
  return out;
}
