import { flattenWorkspace, readWorkspaceText } from './workspaceFs';

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export async function grepWorkspace(
  workspaceRoot: string,
  pattern: string,
  relativeDir = '',
): Promise<{ pattern: string; hits: GrepHit[]; truncated: boolean }> {
  if (!pattern.trim()) throw new Error('pattern is required');
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const files = (await flattenWorkspace(workspaceRoot)).filter((entry) => {
    if (entry.kind !== 'file') return false;
    if (!relativeDir) return true;
    return entry.relativePath === relativeDir || entry.relativePath.startsWith(`${relativeDir}/`);
  });

  const hits: GrepHit[] = [];
  for (const file of files.slice(0, 400)) {
    if (hits.length >= 80) return { pattern, hits, truncated: true };
    let content: string;
    try {
      content = (await readWorkspaceText(workspaceRoot, file.relativePath, 80_000)).content;
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!regex.test(lines[i])) continue;
      hits.push({ path: file.relativePath, line: i + 1, text: lines[i].slice(0, 240) });
      if (hits.length >= 80) return { pattern, hits, truncated: true };
    }
  }
  return { pattern, hits, truncated: false };
}
