import { Hono } from 'hono';
import { applyHarnessProposal, listHarnessProposals } from '../agent/harnessEvolution';

export function createHarnessRouter(dataRoot: string) {
  const router = new Hono();
  router.get('/proposals', async (c) => c.json({ proposals: await listHarnessProposals(dataRoot) }));
  router.post('/proposals/:id/apply', async (c) => {
    try {
      const ok = await applyHarnessProposal(dataRoot, c.req.param('id'));
      return ok ? c.json({ ok: true }) : c.json({ ok: false, error: 'proposal not found' }, 404);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  return router;
}
