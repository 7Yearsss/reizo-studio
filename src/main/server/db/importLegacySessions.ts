import { readdirSync, readFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ChatMessage } from '../../../shared/chat';

interface LegacySession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspacePath?: string | null;
  projectId?: string | null;
  messages: ChatMessage[];
}

function ms(value: string | undefined, fallback: number): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * One-time migration of the JSON-file session store into SQLite. Runs only
 * when the `sessions` table is empty and a legacy `sessions/` directory
 * exists. Original ids and timestamps are preserved (workspace tabs in
 * localStorage reference session ids). The directory is renamed afterwards
 * so this never runs twice.
 */
export function importLegacySessions(dataRoot: string, raw: DatabaseSync): number {
  const legacyDir = path.join(dataRoot, 'sessions');
  if (!existsSync(legacyDir)) return 0;

  const count = raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
  if (count.n > 0) return 0;

  const files = readdirSync(legacyDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insertSession = raw.prepare(
    `INSERT INTO sessions (id, title, created_at, updated_at, workspace_path, project_id, list_message_count, list_preview, list_preview_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMessage = raw.prepare(
    `INSERT INTO messages (id, session_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  let imported = 0;
  raw.exec('BEGIN');
  try {
    for (const file of files) {
      let session: LegacySession;
      try {
        session = JSON.parse(readFileSync(path.join(legacyDir, file), 'utf8')) as LegacySession;
      } catch {
        continue;
      }
      if (!session?.id) continue;

      const createdAt = ms(session.createdAt, Date.now());
      const updatedAt = ms(session.updatedAt, createdAt);
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const last = messages[messages.length - 1];
      const preview = last ? last.content.slice(0, 500) : null;

      insertSession.run(
        session.id,
        session.title ?? '新对话',
        createdAt,
        updatedAt,
        session.workspacePath ?? null,
        session.projectId ?? null,
        messages.length,
        preview,
        last ? last.role : null,
      );
      for (const m of messages) {
        insertMessage.run(
          m.id,
          session.id,
          m.role,
          JSON.stringify({ text: m.content, parts: m.parts ?? null }),
          ms(m.createdAt, createdAt),
        );
      }
      imported += 1;
    }
    raw.exec('COMMIT');
  } catch (err) {
    raw.exec('ROLLBACK');
    throw new Error(
      `Legacy session import failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  renameSync(legacyDir, `${legacyDir}.imported-${Date.now()}`);
  return imported;
}
