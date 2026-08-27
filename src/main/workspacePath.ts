import path from 'node:path';

export const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'out',
  'build',
  '.vite',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo',
  '.cache',
  '.DS_Store',
]);

/**
 * Resolve `candidate` against `workspaceRoot` and reject anything that
 * walks out of the workspace (including absolute paths on another drive).
 */
export function resolveInsideWorkspace(workspaceRoot: string, candidate: string): string {
  if (!workspaceRoot) throw new Error('No workspace is bound');
  const absRoot = path.resolve(workspaceRoot);
  const abs = path.resolve(absRoot, candidate || '.');
  const rel = path.relative(absRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes workspace');
  }
  return abs;
}

export function toWorkspaceRelative(workspaceRoot: string, absPath: string): string {
  const absRoot = path.resolve(workspaceRoot);
  const abs = path.resolve(absPath);
  const rel = path.relative(absRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes workspace');
  }
  return rel.split(path.sep).join('/');
}
