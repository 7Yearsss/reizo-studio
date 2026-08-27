import type { DirEntry } from './workspace';

export interface ReizoBridge {
  platform: NodeJS.Platform;
  getApiOrigin(): Promise<string>;
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<boolean>;
  windowClose(): Promise<void>;
  windowIsMaximized(): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  listWorkspace(relativePath?: string): Promise<DirEntry[]>;
  readWorkspaceFile(relativePath: string): Promise<{ relativePath: string; content: string; truncated: boolean }>;
  flattenWorkspace(): Promise<DirEntry[]>;
  runCommand(command: string): Promise<{ command: string; cwd: string; stdout: string; stderr: string; exitCode: number }>;
  readDroppedFile(filePath: string): Promise<{ name: string; content: string; truncated: boolean }>;
  getPathForFile(file: File): string;
  revealInFolder(relativePath?: string): Promise<void>;
  deleteWorkspacePath(relativePath: string): Promise<{ path: string }>;
  createWorkspaceEntry(relativePath: string, kind: 'file' | 'dir'): Promise<{ path: string; kind: 'file' | 'dir' }>;
  gitStatus(): Promise<{
    available: boolean;
    branch: string | null;
    dirty: boolean;
    porcelain: string;
    recent: string;
  }>;
  installSkill(): Promise<{ id: string } | null>;
  uninstallSkill(id: string): Promise<void>;
}

declare global {
  interface Window {
    reizo: ReizoBridge;
  }
}
