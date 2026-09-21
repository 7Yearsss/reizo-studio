/** Synthetic tool name for the canvas-execution budget checkpoint — a
 * 'permission' interaction carrying this name means the agent hit its per-turn
 * generation quota. Shared because the renderer recognizes it for copy and
 * for "accept proposals also releases the checkpoint". */
export const CANVAS_BUDGET_TOOL = 'canvas_budget';

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
  /**
   * The option the agent would pick — a value from `options`, a `directions`
   * id, or a free-text default. When every question in an ask has one, the
   * card auto-resolves to the recommendations after a countdown unless the
   * user engages or snoozes it.
   */
  recommended?: string;
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
  /** Canvas node whose latest output previews this option (e.g. a draft image on the canvas). */
  nodeId?: string;
  /** Preset sample image — absolute URL, or `skill-asset:<skillId>/<file>` for an asset bundled inside a skill directory. */
  imageUrl?: string;
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

/** One memory entry the user can see in a "已记住/想起了" row. */
export interface MemoryItem {
  file: string;
  name: string;
  description?: string;
  type?: string;
}

/** Persisted memory activity shown inline in the chat timeline. */
export interface MemoryEventRecord {
  id: string;
  createdAt: string;
  action: 'recalled' | 'wrote' | 'deleted';
  items: MemoryItem[];
}

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'status'; phase: 'thinking' | 'tools' | 'replying' | 'waiting'; step?: number; heartbeat?: boolean }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown>; result?: string; error?: string }
  | { type: 'permission'; id: string; name: string; args: Record<string, unknown>; preview?: FileDiffPreview }
  | { type: 'ask'; id: string; questions: AskQuestion[] }
  | { type: 'todos'; items: TodoItem[] }
  | { type: 'tool_loop'; tier: 'warn' | 'halt'; reason: string }
  // Memory activity surfaced to the user: files the agent recalled into this
  // turn, wrote via extraction/tools, or deleted. Rendered inline after the
  // message it follows (matched by createdAt at event time).
  | { type: 'memory'; action: 'recalled' | 'wrote' | 'deleted'; items: MemoryItem[] }
  // A steered (插话) user message the agent loop injected mid-turn — persisted
  // server-side; `content` matches the stored message so canvas-ref chips work.
  | { type: 'user_message'; id: string; content: string; createdAt: string }
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
