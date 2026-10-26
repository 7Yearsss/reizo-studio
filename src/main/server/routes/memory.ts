import { Hono } from 'hono';
import {
  deleteMemoryEntry,
  listMemoryManifest,
  normalizeMemoryType,
  readMemoryEntry,
  writeMemoryEntry,
  type MemoryEntry,
} from '../../workspaceMemoryDir';
import { personalMemoryRoot } from '../agent/personalMemory';
import type { MemoryEventsStore } from '../storage/memoryEventsStore';
import type { SettingsStore } from '../storage/settingsStore';

export type MemoryScope = 'personal' | 'workspace';

export function createMemoryRouter(
  memoryEventsStore: MemoryEventsStore,
  settingsStore: SettingsStore,
  dataRoot?: string,
) {
  const router = new Hono();

  /** The folder a scope's memories live in; null when there is none (no workspace open / no data root). */
  async function rootFor(scope: MemoryScope): Promise<string | null> {
    if (scope === 'personal') return dataRoot ? personalMemoryRoot(dataRoot) : null;
    return (await settingsStore.get()).workspacePath ?? null;
  }
  const scopeOf = (value: string | undefined): MemoryScope => (value === 'personal' ? 'personal' : 'workspace');

  router.get('/events', async (c) => {
    const sessionId = c.req.query('sessionId') ?? '';
    return c.json({ events: sessionId ? await memoryEventsStore.list(sessionId) : [] });
  });

  // Management panel: every entry of one scope, newest first, with full text.
  router.get('/entries', async (c) => {
    const scope = scopeOf(c.req.query('scope'));
    const root = await rootFor(scope);
    if (!root) return c.json({ scope, available: false, entries: [] });
    const manifest = await listMemoryManifest(root);
    const entries = (await Promise.all(manifest.map((m) => readMemoryEntry(root, m.fileName)))).filter((e): e is MemoryEntry => e !== null);
    entries.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return c.json({ scope, available: true, entries });
  });

  // Edit an entry in place: the name (and so the file) stays; text, summary, type and privacy change.
  router.put('/entries/:file', async (c) => {
    const scope = scopeOf(c.req.query('scope'));
    const root = await rootFor(scope);
    if (!root) return c.json({ error: 'No folder for this scope' }, 400);
    const existing = await readMemoryEntry(root, c.req.param('file'));
    if (!existing) return c.json({ error: 'Memory not found' }, 404);
    const body = (await c.req.json().catch((): null => null)) as Record<string, unknown> | null;
    if (!body || typeof body.body !== 'string' || !body.body.trim()) return c.json({ error: 'body is required' }, 400);
    try {
      await writeMemoryEntry(root, {
        name: existing.name,
        description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : existing.description,
        type: body.type === undefined ? existing.type : normalizeMemoryType(body.type),
        body: body.body,
        private: typeof body.private === 'boolean' ? body.private : existing.private === true,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return c.json({ entry: await readMemoryEntry(root, c.req.param('file')) });
  });

  // Undo a memory write — deletes the memory file, refreshes MEMORY.md, and
  // removes it from the session's persisted activity rows when given.
  router.delete('/:file', async (c) => {
    const scope = scopeOf(c.req.query('scope'));
    const root = await rootFor(scope);
    if (!root) return c.json({ error: 'No workspace configured' }, 400);
    const file = c.req.param('file');
    await deleteMemoryEntry(root, file);
    const sessionId = c.req.query('sessionId');
    if (sessionId) await memoryEventsStore.markDeleted(sessionId, file);
    return c.json({ ok: true });
  });

  // Clear a whole scope.
  router.delete('/', async (c) => {
    const scope = scopeOf(c.req.query('scope'));
    const root = await rootFor(scope);
    if (!root) return c.json({ error: 'No folder for this scope' }, 400);
    const manifest = await listMemoryManifest(root);
    for (const item of manifest) await deleteMemoryEntry(root, item.fileName);
    return c.json({ ok: true, removed: manifest.length });
  });

  return router;
}
