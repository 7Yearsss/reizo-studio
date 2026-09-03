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
  /**
   * `direction` renders `directions` as pick-by-looking cards (palette + type
   * sample + mood) instead of a radio list. Anything else is the default
   * choice / free-text control.
   */
  kind?: 'choice' | 'text' | 'direction';
  directions?: DirectionCard[];
}

/** A visual-direction option the user picks by looking, not reading. */
export interface DirectionCard {
  id: string;
  title: string;
  /** 2–6 hex swatches. */
  palette?: string[];
  /** CSS font-family stack for the heading "Aa" sample. */
  displayFont?: string;
  /** CSS font-family stack for the body sample. */
  bodyFont?: string;
  mood?: string;
  /** Real-world exemplars, e.g. ["Monocle", "FT Weekend"]. */
  references?: string[];
}

export type ReplyPhase = 'preparing' | 'thinking' | 'tools' | 'replying' | 'waiting';

/**
 * A before/after snapshot of a single file, carried on a `permission` event
 * for `write_file` / `edit_file` so the renderer can show a real diff *before*
 * the user approves — and echoed back in the tool result so the completed
 * card shows the same view. `before` is `''` for a newly created file.
 */
export interface FileDiffPreview {
  path: string;
  before: string;
  after: string;
  /** Either side was clipped to a size limit; the diff is indicative only. */
  truncated?: boolean;
}

export const FILE_DIFF_PREVIEW_MAX_CHARS = 60_000;

/** Clamp both sides of a file diff so a huge file can't bloat the wire. */
export function buildFileDiffPreview(
  path: string,
  before: string,
  after: string,
  maxChars = FILE_DIFF_PREVIEW_MAX_CHARS,
): FileDiffPreview {
  const clip = (value: string) => (value.length > maxChars ? value.slice(0, maxChars) : value);
  const truncated = before.length > maxChars || after.length > maxChars;
  return { path, before: clip(before), after: clip(after), ...(truncated ? { truncated: true } : {}) };
}

export type TurnOutcome = 'completed' | 'interrupted' | 'error';

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'status'; phase: 'thinking' | 'tools' | 'replying' | 'waiting'; step?: number; heartbeat?: boolean }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown>; result?: string; error?: string }
  | { type: 'permission'; id: string; name: string; args: Record<string, unknown>; preview?: FileDiffPreview }
  | { type: 'ask'; id: string; questions: AskQuestion[] }
  | { type: 'todos'; items: TodoItem[] }
  | { type: 'tool_loop'; tier: 'warn' | 'halt'; reason: string }
  | { type: 'error'; error: string }
  | { type: 'done'; outcome: TurnOutcome; aborted?: boolean; error?: string };

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
