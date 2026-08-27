export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface AskQuestion {
  id: string;
  prompt: string;
  options?: string[];
  multi?: boolean;
}

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown>; result?: string; error?: string }
  | { type: 'permission'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'ask'; id: string; questions: AskQuestion[] }
  | { type: 'todos'; items: TodoItem[] }
  | { type: 'error'; error: string }
  | { type: 'done'; aborted?: boolean };

export function encodeStreamEvent(event: ChatStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseStreamLine(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ChatStreamEvent;
  } catch {
    return { type: 'text', delta: trimmed };
  }
}
