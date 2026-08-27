import { readWorkspaceText } from './workspaceFs';
import { writeWorkspaceFile } from './workspaceWrite';

const MEMORY_FILE = 'MEMORY.md';

export async function readWorkspaceMemory(workspaceRoot: string): Promise<string> {
  try {
    return (await readWorkspaceText(workspaceRoot, MEMORY_FILE, 20_000)).content;
  } catch {
    return '';
  }
}

export async function writeWorkspaceMemory(workspaceRoot: string, content: string): Promise<{ path: string }> {
  const result = await writeWorkspaceFile(workspaceRoot, MEMORY_FILE, content);
  return { path: result.path };
}
