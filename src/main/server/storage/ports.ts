export type ChatRole = 'user' | 'assistant' | 'system';

export interface ToolCallPart {
  type: 'tool';
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  parts?: ToolCallPart[];
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspacePath?: string | null;
}

export interface Session extends SessionSummary {
  messages: ChatMessage[];
}

/**
 * Storage port — the same shape as winlume's SessionStore interface
 * (src/lib/host/ports.ts), reimplemented fresh for the desktop app.
 * A future adapter (e.g. cloud sync) can implement this without touching
 * route/agent code.
 */
export interface SessionStore {
  list(): Promise<SessionSummary[]>;
  get(id: string): Promise<Session | null>;
  create(title?: string, workspacePath?: string | null): Promise<Session>;
  appendMessage(id: string, message: ChatMessage): Promise<Session>;
  rename(id: string, title: string): Promise<Session>;
  remove(id: string): Promise<void>;
}
