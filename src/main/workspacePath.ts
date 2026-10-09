import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

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

function isOutside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/** New files still need the closest existing ancestor checked for links. */
function canonicalPath(candidate: string): string {
  const missing: string[] = [];
  let existing = candidate;
  for (;;) {
    try { return path.resolve(realpathSync.native(existing), ...missing); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let isMissing = false;
      try { lstatSync(existing); }
      catch (entryError) { if ((entryError as NodeJS.ErrnoException).code === 'ENOENT') isMissing = true; else throw entryError; }
      if (!isMissing) throw new Error('Workspace filesystem link cannot be resolved safely');
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(path.basename(existing)); existing = parent;
    }
  }
}

/** Resolve both lexical paths and real filesystem targets within the bound root. */
export function resolveInsideWorkspace(workspaceRoot: string, candidate: string): string {
  if (!workspaceRoot) throw new Error('No workspace is bound');
  const absRoot = path.resolve(workspaceRoot);
  const abs = path.resolve(absRoot, candidate || '.');
  if (isOutside(absRoot, abs)) {
    throw new Error('Path escapes workspace');
  }
  const realRoot = realpathSync.native(absRoot);
  const realTarget = canonicalPath(abs);
  if (isOutside(realRoot, realTarget)) throw new Error('Path escapes workspace through a filesystem link');
  return realTarget;
}

export function toWorkspaceRelative(workspaceRoot: string, absPath: string): string {
  const absRoot = realpathSync.native(path.resolve(workspaceRoot));
  const abs = canonicalPath(path.resolve(absPath));
  const rel = path.relative(absRoot, abs);
  if (isOutside(absRoot, abs)) {
    throw new Error('Path escapes workspace');
  }
  return rel.split(path.sep).join('/');
}
