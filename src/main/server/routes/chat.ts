import { Hono } from 'hono';
import type { SessionStore } from '../../../shared/chat';
import type { SettingsStore } from '../storage/settingsStore';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ProjectStore } from '../storage/projectStore';
import { abortChatTurn, runChatTurn } from '../agent/runtime';
import { resumeAgentTurn } from '../agent/session';
import { answerAsk, answerPermission, type PermissionDecision } from '../agent/permissions';
import { loadSkills } from '../../skills';
import type { LargeValueStore } from '../storage/largeValueStore';

const DECISIONS = new Set<PermissionDecision>(['allow', 'deny', 'allow-session']);

export function createChatRouter(
  sessionStore: SessionStore,
  settingsStore: SettingsStore,
  skillsDirs: string[] = [],
  artifactStore?: ArtifactStore,
  projectStore?: ProjectStore,
  largeValueStore?: LargeValueStore,
) {
  const router = new Hono();

  router.patch('/:id/messages', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.truncateAfterId !== 'string' || !body.truncateAfterId.trim()) {
      return c.json({ error: 'truncateAfterId is required' }, 400);
    }
    const session = await sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    const idx = session.messages.findIndex((m) => m.id === body.truncateAfterId);
    if (idx < 0) return c.json({ error: 'truncateAfterId not found' }, 404);
    const updated = await sessionStore.setMessages(
      session.id,
      session.messages.slice(0, idx),
    );
    return c.json({ session: updated });
  });

  router.post('/:id/messages', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.text !== 'string' || !body.text.trim()) {
      return c.json({ error: 'text is required' }, 400);
    }

    const mentions = Array.isArray(body.mentions)
      ? body.mentions.filter((m: unknown) => typeof m === 'string')
      : [];
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.filter(
          (file: unknown) =>
            file &&
            typeof file === 'object' &&
            typeof (file as { name?: unknown }).name === 'string' &&
            typeof (file as { content?: unknown }).content === 'string',
        )
      : [];

    let skill = null;
    if (typeof body.skillId === 'string' && body.skillId.trim()) {
      const skills = await loadSkills(skillsDirs);
      skill = skills.find((item) => item.id === body.skillId) ?? null;
    }

    return runChatTurn({
      sessionStore,
      settingsStore,
      sessionId: c.req.param('id'),
      userText: body.text,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
      mentions,
      skill,
      attachments,
      artifactStore,
      projectStore,
      truncateAfterId: typeof body.truncateAfterId === 'string' ? body.truncateAfterId : undefined,
      regenerate: body.regenerate === true,
      largeValueStore,
    });
  });

  // Reattach to an in-flight turn after a dropped connection / window reload.
  // Replays ring-buffer events with rev > `after`, then tails the live turn
  // (or sends a terminal `done` if it already finished).
  router.get('/:id/stream/resume', (c) => {
    const after = Number(c.req.query('after') ?? '-1');
    const epoch = c.req.query('epoch') || undefined;
    return resumeAgentTurn(c.req.param('id'), {
      after: Number.isFinite(after) ? after : -1,
      epoch,
    });
  });

  router.post('/:id/stop', (c) => {
    abortChatTurn(c.req.param('id'));
    return c.json({ ok: true });
  });

  router.post('/:id/permissions', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.id !== 'string' || !DECISIONS.has(body.decision)) {
      return c.json({ error: 'id and decision are required' }, 400);
    }
    const ok = answerPermission(body.id, body.decision);
    return c.json({ ok });
  });

  router.post('/:id/ask', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.id !== 'string' || !body.answers || typeof body.answers !== 'object') {
      return c.json({ error: 'id and answers are required' }, 400);
    }
    const ok = answerAsk(body.id, body.answers as Record<string, string>);
    return c.json({ ok });
  });

  return router;
}
