import { Hono } from 'hono';
import { hasSearch, hasTrash, TRASH_RETENTION_MS, type SessionStore } from '../../../shared/chat';
import type { ArtifactStore } from '../storage/artifactStore';
import { pendingInteractionKindForSession } from '../agent/permissions';
import { isSessionTurnLive } from '../agent/session';
import { compactSession, estimateSessionTokens, type RewriteText } from '../agent/compaction';
import { compactLevel, DEFAULT_CONTEXT_WINDOW_TOKENS } from '../../../shared/autoCompact';
import { closeSessionMcp } from '../agent/mcpTools';
import { buildSessionExport, sessionToMarkdown } from '../../../shared/sessionExport';

export function createSessionsRouter(sessionStore: SessionStore, artifactStore?: ArtifactStore,
  prepareRemove?: (sessionId: string) => (() => void) | void, rewriteText?: RewriteText,
  /** Context window of the model the next turn will use, when known; otherwise the default applies. */
  getWindowTokens?: () => Promise<number | undefined>) {
  const router = new Hono();

  // Retention sweep at boot: trashed sessions past the retention period go for good, artifacts included.
  if (hasTrash(sessionStore)) {
    void sessionStore.purgeExpired(TRASH_RETENTION_MS)
      .then(async (ids) => { if (artifactStore) for (const id of ids) await artifactStore.removeBySession(id); })
      .catch((error) => console.warn('[sessions] trash purge failed', error));
  }

  // How full the model's context is (an estimate of what the next request would carry).
  router.get('/:id/context', async (c) => {
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    const usedTokens = estimateSessionTokens(session.messages);
    const windowTokens = (await getWindowTokens?.().catch((): undefined => undefined)) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    return c.json({ usedTokens, windowTokens, ratio: usedTokens / windowTokens, level: compactLevel(usedTokens, windowTokens) });
  });

  // /compact: replace the older part of the conversation with a model-written summary (the transcript stays).
  router.post('/:id/compact', async (c) => {
    if (!rewriteText) return c.json({ error: 'compaction is not configured' }, 400);
    const id = c.req.param('id');
    if (isSessionTurnLive(id)) return c.json({ error: '会话正在运行，请等它结束后再压缩' }, 409);
    try {
      const result = await compactSession({ sessionStore, sessionId: id, rewriteText, keepRecentTurns: 1, source: 'manual' });
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  });

  router.get('/search', async (c) => {
    if (!hasSearch(sessionStore)) return c.json({ hits: [] });
    return c.json({ hits: await sessionStore.searchMessages(c.req.query('q') ?? '', 30) });
  });

  router.get('/trash', async (c) => {
    if (!hasTrash(sessionStore)) return c.json({ sessions: [] });
    return c.json({ sessions: await sessionStore.listDeleted(), retentionDays: TRASH_RETENTION_MS / 86_400_000 });
  });

  router.post('/:id/restore', async (c) => {
    if (!hasTrash(sessionStore) || !(await sessionStore.restore(c.req.param('id')))) return c.json({ error: 'Session not in trash' }, 404);
    return c.json({ session: await sessionStore.get(c.req.param('id')) });
  });

  router.get('/', async (c) => {
    const projectId = c.req.query('projectId');
    let sessions = await sessionStore.list();
    if (projectId) sessions = sessions.filter((s) => s.projectId === projectId);
    return c.json({
      sessions: sessions.map((s) => ({ ...s, pendingInteraction: pendingInteractionKindForSession(s.id) })),
    });
  });

  router.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const workspacePath =
      typeof body?.workspacePath === 'string' ? body.workspacePath : body?.workspacePath === null ? null : undefined;
    const projectId =
      typeof body?.projectId === 'string' ? body.projectId : body?.projectId === null ? null : undefined;
    const session = await sessionStore.create(body?.title, workspacePath, projectId);
    return c.json({ session }, 201);
  });

  router.get('/:id', async (c) => {
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({ session });
  });

  // Redacted, shareable copy: ?format=json|md, ?detail=structure|full (default structure, for troubleshooting).
  router.get('/:id/export', async (c) => {
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    const detail = c.req.query('detail') === 'full' ? 'full' : 'structure';
    const exported = buildSessionExport(session, detail);
    if (c.req.query('format') === 'md') {
      return c.json({ format: 'md', detail, stats: exported.stats, content: sessionToMarkdown(exported.title, exported.messages) });
    }
    return c.json({ format: 'json', detail, stats: exported.stats, title: exported.title, messages: exported.messages });
  });

  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const hasTitle = typeof body?.title === 'string' && body.title.trim();
    const hasProject = body?.projectId === null || typeof body?.projectId === 'string';
    const pinned = typeof body?.pinned === 'boolean' ? body.pinned : undefined;
    const archived = typeof body?.archived === 'boolean' ? body.archived : undefined;
    if (!hasTitle && !hasProject && pinned === undefined && archived === undefined) {
      return c.json({ error: 'title, projectId, pinned or archived is required' }, 400);
    }
    // A running turn would keep working in a session the user just tucked away; make them stop it first (or say force).
    if (archived && isSessionTurnLive(c.req.param('id')) && body?.force !== true) {
      return c.json({ error: 'Session is running', code: 'session_running' }, 409);
    }
    try {
      const session = await sessionStore.update(c.req.param('id'), {
        title: hasTitle ? body.title : undefined,
        projectId: hasProject ? body.projectId : undefined,
        pinned,
        archived,
      });
      return c.json({ session });
    } catch {
      return c.json({ error: 'Session not found' }, 404);
    }
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (isSessionTurnLive(id)) return c.json({ error: 'Session is running; stop it before deleting' }, 409);
    // Default delete moves to trash (artifacts kept, restorable). ?permanent=1 removes for good.
    if (hasTrash(sessionStore) && c.req.query('permanent') !== '1') {
      void closeSessionMcp(id);
      await sessionStore.softDelete(id);
      return c.body(null, 204);
    }
    const afterRemove = prepareRemove?.(id);
    if (artifactStore) await artifactStore.removeBySession(id);
    await sessionStore.remove(id);
    if (typeof afterRemove === 'function') afterRemove();
    return c.body(null, 204);
  });

  return router;
}
