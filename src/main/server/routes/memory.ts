import { Hono } from 'hono';
import { deleteMemoryEntry } from '../../workspaceMemoryDir';
import type { MemoryEventsStore } from '../storage/memoryEventsStore';
import type { SettingsStore } from '../storage/settingsStore';

export function createMemoryRouter(
  memoryEventsStore: MemoryEventsStore,
  settingsStore: SettingsStore,
) {
  const router = new Hono();

  router.get('/events', async (c) => {
    const sessionId = c.req.query('sessionId') ?? '';
    return c.json({ events: sessionId ? await memoryEventsStore.list(sessionId) : [] });
  });

  // Undo a memory write — deletes the memory file and refreshes MEMORY.md.
  router.delete('/:file', async (c) => {
    const settings = await settingsStore.get();
    const workspace = settings.workspacePath;
    if (!workspace) return c.json({ error: 'No workspace configured' }, 400);
    const file = c.req.param('file');
    await deleteMemoryEntry(workspace, file);
    return c.json({ ok: true });
  });

  return router;
}
