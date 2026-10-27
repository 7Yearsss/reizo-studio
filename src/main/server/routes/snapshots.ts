import { Hono } from 'hono';
import { hashContent, type FileSnapshotStore } from '../storage/fileSnapshots';
import { deleteWorkspacePath, readWorkspaceFileSnapshot, writeWorkspaceFile } from '../../workspaceWrite';

/**
 * "回滚此次修改": put a file back the way it was before one agent write. If the file has changed again since (by you or
 * a later agent edit) it asks first (409 `changed`) instead of silently discarding that newer work.
 */
export function createSnapshotsRouter(options: { snapshots: FileSnapshotStore; getWorkspace: () => Promise<string | null> }) {
  const router = new Hono();

  router.post('/:id/snapshots/:sid/rollback', async (c) => {
    const sessionId = c.req.param('id');
    const snapshot = await options.snapshots.get(sessionId, c.req.param('sid'));
    if (!snapshot) return c.json({ error: '找不到这次修改的快照（可能已被清理）' }, 404);
    const workspace = await options.getWorkspace();
    if (!workspace) return c.json({ error: '没有打开工作区' }, 400);
    const force = ((await c.req.json().catch((): null => null)) as { force?: unknown } | null)?.force === true;
    try {
      const current = await readWorkspaceFileSnapshot(workspace, snapshot.path);
      const currentHash = current.expectedHash === null ? null : hashContent(current.content);
      if (!force && currentHash !== snapshot.afterHash && !(currentHash === null && !snapshot.existed)) {
        return c.json({ error: '这个文件在那次修改之后又变过了；回滚会丢掉之后的改动。', code: 'changed' }, 409);
      }
      if (snapshot.existed) await writeWorkspaceFile(workspace, snapshot.path, snapshot.before);
      else await deleteWorkspacePath(workspace, snapshot.path);
      await options.snapshots.remove(sessionId, snapshot.id);
      return c.json({ ok: true, path: snapshot.path, restored: snapshot.existed ? 'content' : 'deleted' });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  return router;
}
