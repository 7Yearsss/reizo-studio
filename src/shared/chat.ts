/**
 * Chat wire types — the contract shared by the Hono server, the agent
 * runtime, and the React renderer. Moved here from
 * `src/main/server/storage/ports.ts` so the renderer stops importing across
 * the process boundary. `ports.ts` re-exports these for a transition period.
 *
 * Timestamps on the wire stay ISO-8601 strings. The SQLite store keeps them
 * as unix-ms integers internally and converts at its boundary, so this DTO
 * shape is unchanged for existing consumers.
 */

/**
 * `user` / `assistant` / `system` are the only roles produced today. The
 * rest are infrastructure roles reserved for later phases (harness switch,
 * hidden context-rebuild prefix, tombstones, split-out tool rows, reasoning)
 * — declared now so the message table and renderer switch are forward
 * compatible.
 */
export type ChatRole =
  | 'user'
  | 'assistant'
  | 'system'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'error'
  | 'agent_switch'
  | 'context_rebuild'
  | 'message_tombstone';

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
  /**
   * Backend-allocated stable id for an assistant row, stamped into the live
   * stream on the first delta so the renderer's streaming bubble already
   * carries the final row id (replace-not-append on landing). Populated from
   * Phase 1 onward; absent on historical rows.
   */
  clientId?: string;
  /** Pairs a `tool_result` row to its `tool_use`. Reserved for Phase 1. */
  toolUseId?: string;
  /** Which harness wrote this row. Reserved for multi-harness. */
  agentKind?: string;
  /** Groups rows produced within one turn. Reserved for Phase 1. */
  turnId?: string;
  /** Monotonic turn generation the row was produced under. Reserved. */
  generation?: number;
  /** Soft-delete marker (ISO). Rewound rows stay as an audit trail. */
  rewindAt?: string | null;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspacePath?: string | null;
  projectId?: string | null;
  /**
   * Append-only turn markers for interrupted-turn detection (Phase 2). A
   * session with `activeTurnStartedAt > lastTurnEndedAt` and no local
   * in-flight send is a suspected interrupted turn. ISO strings on the wire.
   */
  activeTurnStartedAt?: string | null;
  lastTurnEndedAt?: string | null;
  /** Denormalised sidebar projection, maintained in the same write. */
  listPreview?: string | null;
  listPreviewRole?: ChatRole | null;
  listMessageCount?: number;
}

export interface Session extends SessionSummary {
  messages: ChatMessage[];
}

export interface SessionPatch {
  title?: string;
  projectId?: string | null;
}

/**
 * Optional runtime-state hooks a store may implement. The SQLite store does;
 * the JSON file store doesn't, and the agent layer feature-detects — crash
 * detection and resumable-stream revision persistence are simply skipped
 * when absent.
 */
export interface TurnRuntimeStore {
  /** Stamp `active_turn_started_at = now`. Append-only, no clear op. */
  markTurnStart(sessionId: string): void;
  /** Stamp `last_turn_ended_at = now`. No-op after `freezeTurnMarkers`. */
  markTurnEnd(sessionId: string): void;
  setLiveRevision(sessionId: string, rev: number): void;
  getRuntimeState(
    sessionId: string,
  ): { activeTurnStartedAt: number | null; lastTurnEndedAt: number | null; liveRevision: number } | null;
  /** Quit-chain guard: makes subsequent `markTurnEnd` calls no-ops. */
  freezeTurnMarkers(): void;
}

/**
 * Storage port. A future adapter (SQLite worker process, cloud sync) can
 * implement this without touching route/agent code.
 */
export interface SessionStore {
  list(): Promise<SessionSummary[]>;
  get(id: string): Promise<Session | null>;
  create(title?: string, workspacePath?: string | null, projectId?: string | null): Promise<Session>;
  appendMessage(id: string, message: ChatMessage): Promise<Session>;
  /**
   * Replace the message list. In the SQLite store this is
   * "soft-delete the tail + append", not a physical rewrite — rewound rows
   * stay with `rewindAt` set. The file store still truncates.
   */
  setMessages(id: string, messages: ChatMessage[]): Promise<Session>;
  rename(id: string, title: string): Promise<Session>;
  update(id: string, patch: SessionPatch): Promise<Session>;
  remove(id: string): Promise<void>;
}
