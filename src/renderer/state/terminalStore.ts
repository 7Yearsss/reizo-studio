export interface TerminalLine {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  createdAt: string;
}

let lines: TerminalLine[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): TerminalLine[] {
  return lines;
}

export function appendTerminalLine(line: Omit<TerminalLine, 'id' | 'createdAt'> & { id?: string }): void {
  lines = [
    ...lines,
    {
      id: line.id ?? `term-${Date.now()}-${lines.length}`,
      command: line.command,
      stdout: line.stdout,
      stderr: line.stderr,
      exitCode: line.exitCode,
      createdAt: new Date().toISOString(),
    },
  ].slice(-80);
  notify();
}
