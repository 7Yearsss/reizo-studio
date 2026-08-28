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

/**
 * Parses one NDJSON line into a `ChatStreamEvent`. Since Phase 2 the wire
 * carries `LiveEnvelope` objects; this transparently unwraps them so
 * existing consumers keep receiving bare events. Phase 3 reads the envelope
 * metadata (`rev`/`epoch`) before unwrapping.
 */
export function parseStreamLine(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      parsed &&
      parsed.v === 1 &&
      parsed.event &&
      typeof (parsed.event as { type?: unknown }).type === 'string'
    ) {
      return parsed.event as ChatStreamEvent;
    }
    return parsed as unknown as ChatStreamEvent;
  } catch {
    return { type: 'text', delta: trimmed };
  }
}
