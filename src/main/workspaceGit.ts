import { runWorkspaceCommand } from './workspaceShell';

export interface GitStatus {
  available: boolean;
  branch: string | null;
  dirty: boolean;
  porcelain: string;
  recent: string;
}

export async function readGitStatus(workspaceRoot: string): Promise<GitStatus> {
  const inside = await runWorkspaceCommand(workspaceRoot, 'git rev-parse --is-inside-work-tree');
  if (inside.exitCode !== 0 || !inside.stdout.trim().includes('true')) {
    return { available: false, branch: null, dirty: false, porcelain: '', recent: '' };
  }
  const [branch, status, log] = await Promise.all([
    runWorkspaceCommand(workspaceRoot, 'git rev-parse --abbrev-ref HEAD'),
    runWorkspaceCommand(workspaceRoot, 'git status --porcelain'),
    runWorkspaceCommand(workspaceRoot, 'git log -8 --oneline'),
  ]);
  return {
    available: true,
    branch: branch.stdout.trim() || null,
    dirty: status.stdout.trim().length > 0,
    porcelain: status.stdout,
    recent: log.stdout,
  };
}
