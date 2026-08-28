import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ChatMessage, Session, SessionPatch, SessionStore, SessionSummary } from '../../../shared/chat';

/**
 * Local-only session store: one JSON file per session under
 * `<userData>/data/sessions/<id>.json`. Mirrors the shape of winlume's
 * local file-store adapter (src/lib/host/web/file-store.ts) — sessions are
 * plain files, not database rows, so there's nothing to migrate later.
 */
export function createFileSessionStore(root: string): SessionStore {
  const dir = path.join(root, 'sessions');

  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  function filePath(id: string): string {
    return path.join(dir, `${id}.json`);
  }

  async function readSession(id: string): Promise<Session | null> {
    try {
      const raw = await readFile(filePath(id), 'utf8');
      return JSON.parse(raw) as Session;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async function writeSession(session: Session): Promise<void> {
    await ensureDir();
    await writeFile(filePath(session.id), JSON.stringify(session, null, 2), 'utf8');
  }

  return {
    async list() {
      await ensureDir();
      const files = await readdir(dir);
      const sessions = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const raw = await readFile(path.join(dir, f), 'utf8');
            const session = JSON.parse(raw) as Session;
            const { id, title, createdAt, updatedAt, workspacePath, projectId } = session;
            return { id, title, createdAt, updatedAt, workspacePath, projectId } satisfies SessionSummary;
          }),
      );
      return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async get(id: string) {
      return readSession(id);
    },

    async create(title = '新对话', workspacePath?: string | null, projectId?: string | null) {
      const now = new Date().toISOString();
      const session: Session = {
        id: nanoid(),
        title,
        createdAt: now,
        updatedAt: now,
        workspacePath: workspacePath ?? null,
        projectId: projectId ?? null,
        messages: [],
      };
      await writeSession(session);
      return session;
    },

    async appendMessage(id: string, message: ChatMessage) {
      const session = await readSession(id);
      if (!session) throw new Error(`Session not found: ${id}`);
      session.messages.push(message);
      session.updatedAt = new Date().toISOString();
      await writeSession(session);
      return session;
    },

    async setMessages(id: string, messages: ChatMessage[]) {
      const session = await readSession(id);
      if (!session) throw new Error(`Session not found: ${id}`);
      session.messages = messages;
      session.updatedAt = new Date().toISOString();
      await writeSession(session);
      return session;
    },

    async update(id: string, patch: SessionPatch) {
      const session = await readSession(id);
      if (!session) throw new Error(`Session not found: ${id}`);
      if (typeof patch.title === 'string' && patch.title.trim()) {
        session.title = patch.title.trim();
      }
      if (patch.projectId !== undefined) {
        session.projectId = patch.projectId;
      }
      session.updatedAt = new Date().toISOString();
      await writeSession(session);
      return session;
    },

    async rename(id: string, title: string) {
      const session = await readSession(id);
      if (!session) throw new Error(`Session not found: ${id}`);
      session.title = title;
      session.updatedAt = new Date().toISOString();
      await writeSession(session);
      return session;
    },

    async remove(id: string) {
      await rm(filePath(id), { force: true });
    },
  };
}
