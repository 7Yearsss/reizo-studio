import { nanoid } from 'nanoid';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ChatMessage,
  ChatRole,
  Session,
  SessionPatch,
  SessionStore,
  SessionSummary,
  ToolCallPart,
  TurnRuntimeStore,
} from '../../../shared/chat';
import type { DbHandle } from '../db/client';

const PREVIEW_CHARS = 500;

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' ? new Date(ms).toISOString() : null;
}

interface SessionRowRaw {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  workspace_path: string | null;
  project_id: string | null;
  active_turn_started_at: number | null;
  last_turn_ended_at: number | null;
  list_preview: string | null;
  list_preview_role: string | null;
  list_message_count: number;
}

interface MessageRowRaw {
  id: string;
  client_id: string | null;
  role: string;
  content: string;
  tool_use_id: string | null;
  agent_kind: string | null;
  turn_id: string | null;
  generation: number | null;
  rewind_at: number | null;
  created_at: number;
}

function toSummary(row: SessionRowRaw): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    workspacePath: row.workspace_path,
    projectId: row.project_id,
    activeTurnStartedAt: iso(row.active_turn_started_at),
    lastTurnEndedAt: iso(row.last_turn_ended_at),
    listPreview: row.list_preview,
    listPreviewRole: (row.list_preview_role as ChatRole | null) ?? null,
    listMessageCount: row.list_message_count,
  };
}

function decodeContent(raw: string): { text: string; parts?: ToolCallPart[] } {
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; parts?: unknown };
    if (parsed && typeof parsed === 'object' && 'text' in parsed) {
      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        parts: Array.isArray(parsed.parts) ? (parsed.parts as ToolCallPart[]) : undefined,
      };
    }
  } catch {
    /* legacy / plain string */
  }
  return { text: raw };
}

function encodeContent(message: ChatMessage): string {
  return JSON.stringify({ text: message.content, parts: message.parts ?? null });
}

function toMessage(row: MessageRowRaw): ChatMessage {
  const { text, parts } = decodeContent(row.content);
  return {
    id: row.id,
    role: row.role as ChatRole,
    content: text,
    parts: parts && parts.length ? parts : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    clientId: row.client_id ?? undefined,
    toolUseId: row.tool_use_id ?? undefined,
    agentKind: row.agent_kind ?? undefined,
    turnId: row.turn_id ?? undefined,
    generation: row.generation ?? undefined,
    rewindAt: iso(row.rewind_at),
  };
}

/**
 * SQLite-backed SessionStore. Writes go straight through `node:sqlite`
 * (synchronous, explicit BEGIN/COMMIT) rather than the drizzle proxy, which
 * has no `transaction()`. Per-session serialization guards concurrent turns
 * doing read-modify-write on the same session.
 */
export function createSqliteSessionStore(handle: DbHandle): SessionStore & TurnRuntimeStore {
  const raw: DatabaseSync = handle.raw;
  let turnMarkersFrozen = false;

  // Serialize mutations per session id.
  const chains = new Map<string, Promise<unknown>>();
  function withLock<T>(id: string, fn: () => T): Promise<T> {
    const prev: Promise<unknown> = chains.get(id) ?? Promise.resolve();
    const run: Promise<T> = prev.then(fn, fn);
    chains.set(id, run.catch((): void => undefined));
    return run;
  }

  const selSession = raw.prepare('SELECT * FROM sessions WHERE id = ?');
  const selMessages = raw.prepare(
    'SELECT * FROM messages WHERE session_id = ? AND rewind_at IS NULL ORDER BY rowid',
  );

  function readSummary(id: string): SessionSummary | null {
    const row = selSession.get(id) as unknown as SessionRowRaw | undefined;
    return row ? toSummary(row) : null;
  }

  function readSession(id: string): Session | null {
    const summary = readSummary(id);
    if (!summary) return null;
    const rows = selMessages.all(id) as unknown as MessageRowRaw[];
    return { ...summary, messages: rows.map(toMessage) };
  }

  function requireSession(id: string): Session {
    const session = readSession(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }

  const insertMessage = raw.prepare(
    `INSERT INTO messages
       (id, client_id, session_id, role, content, tool_use_id, agent_kind, turn_id, generation, rewind_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function insertMsgRow(sessionId: string, message: ChatMessage): void {
    insertMessage.run(
      message.id,
      message.clientId ?? null,
      sessionId,
      message.role,
      encodeContent(message),
      message.toolUseId ?? null,
      message.agentKind ?? null,
      message.turnId ?? null,
      typeof message.generation === 'number' ? message.generation : null,
      message.rewindAt ? Date.parse(message.rewindAt) : null,
      message.createdAt ? Date.parse(message.createdAt) : Date.now(),
    );
  }

  const refreshProjection = raw.prepare(
    `UPDATE sessions SET
       updated_at = ?,
       list_message_count = (SELECT COUNT(*) FROM messages WHERE session_id = ? AND rewind_at IS NULL),
       list_preview = (
         SELECT substr(coalesce(json_extract(content, '$.text'), content), 1, ${PREVIEW_CHARS})
         FROM messages WHERE session_id = ? AND rewind_at IS NULL ORDER BY rowid DESC LIMIT 1
       ),
       list_preview_role = (
         SELECT role FROM messages WHERE session_id = ? AND rewind_at IS NULL ORDER BY rowid DESC LIMIT 1
       )
     WHERE id = ?`,
  );

  function touch(id: string, now = Date.now()): void {
    refreshProjection.run(now, id, id, id, id);
  }

  const insertSession = raw.prepare(
    `INSERT INTO sessions (id, title, created_at, updated_at, workspace_path, project_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  return {
    async list() {
      const rows = raw
        .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
        .all() as unknown as SessionRowRaw[];
      return rows.map(toSummary);
    },

    async get(id: string) {
      return readSession(id);
    },

    async create(title = '新对话', workspacePath?: string | null, projectId?: string | null) {
      const id = nanoid();
      const now = Date.now();
      insertSession.run(id, title, now, now, workspacePath ?? null, projectId ?? null);
      return requireSession(id);
    },

    async appendMessage(id: string, message: ChatMessage) {
      return withLock(id, () => {
        if (!readSummary(id)) throw new Error(`Session not found: ${id}`);
        raw.exec('BEGIN');
        try {
          insertMsgRow(id, message);
          touch(id);
          raw.exec('COMMIT');
        } catch (err) {
          raw.exec('ROLLBACK');
          throw err;
        }
        return requireSession(id);
      });
    },

    async setMessages(id: string, messages: ChatMessage[]) {
      return withLock(id, () => {
        if (!readSummary(id)) throw new Error(`Session not found: ${id}`);
        const keep = new Set(messages.map((m) => m.id));
        const existing = raw
          .prepare('SELECT id, rewind_at FROM messages WHERE session_id = ?')
          .all(id) as { id: string; rewind_at: number | null }[];
        const existingById = new Map(existing.map((r) => [r.id, r.rewind_at] as const));
        const now = Date.now();
        raw.exec('BEGIN');
        try {
          // Soft-delete active rows the new list drops.
          for (const row of existing) {
            if (row.rewind_at === null && !keep.has(row.id)) {
              raw.prepare('UPDATE messages SET rewind_at = ? WHERE session_id = ? AND id = ?').run(
                now,
                id,
                row.id,
              );
            }
          }
          // Insert genuinely new rows; revive a previously-rewound id if it reappears.
          for (const message of messages) {
            const priorRewind = existingById.get(message.id);
            if (priorRewind === undefined) {
              insertMsgRow(id, message);
            } else if (priorRewind !== null) {
              raw
                .prepare('UPDATE messages SET rewind_at = NULL, content = ? WHERE session_id = ? AND id = ?')
                .run(encodeContent(message), id, message.id);
            }
          }
          touch(id, now);
          raw.exec('COMMIT');
        } catch (err) {
          raw.exec('ROLLBACK');
          throw err;
        }
        return requireSession(id);
      });
    },

    async update(id: string, patch: SessionPatch) {
      return withLock(id, () => {
        const current = readSummary(id);
        if (!current) throw new Error(`Session not found: ${id}`);
        const title =
          typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : current.title;
        const projectId = patch.projectId !== undefined ? patch.projectId : current.projectId ?? null;
        raw
          .prepare('UPDATE sessions SET title = ?, project_id = ?, updated_at = ? WHERE id = ?')
          .run(title, projectId, Date.now(), id);
        return requireSession(id);
      });
    },

    async rename(id: string, title: string) {
      return withLock(id, () => {
        if (!readSummary(id)) throw new Error(`Session not found: ${id}`);
        raw.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(
          title,
          Date.now(),
          id,
        );
        return requireSession(id);
      });
    },

    async remove(id: string) {
      await withLock(id, () => {
        raw.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      });
    },

    // --- TurnRuntimeStore: append-only turn markers for crash detection ---

    markTurnStart(id: string) {
      raw.prepare('UPDATE sessions SET active_turn_started_at = ? WHERE id = ?').run(Date.now(), id);
    },

    markTurnEnd(id: string) {
      if (turnMarkersFrozen) return;
      raw.prepare('UPDATE sessions SET last_turn_ended_at = ? WHERE id = ?').run(Date.now(), id);
    },

    setLiveRevision(id: string, rev: number) {
      raw.prepare('UPDATE sessions SET live_revision = ? WHERE id = ?').run(rev, id);
    },

    getRuntimeState(id: string) {
      const row = raw
        .prepare(
          'SELECT active_turn_started_at AS a, last_turn_ended_at AS e, live_revision AS r FROM sessions WHERE id = ?',
        )
        .get(id) as { a: number | null; e: number | null; r: number } | undefined;
      if (!row) return null;
      return { activeTurnStartedAt: row.a, lastTurnEndedAt: row.e, liveRevision: row.r };
    },

    /**
     * Quit-chain: after this, `markTurnEnd` is a no-op so the shutdown
     * close path can't forge a normal ending over an interrupted turn.
     */
    freezeTurnMarkers() {
      turnMarkersFrozen = true;
    },
  };
}
