import type { ArtifactReviewStore } from '../storage/artifactReviewStore';
import { findExpertMention, type ExpertAgent } from '../../../shared/expertAgent';
import type { ExpertStore } from '../storage/expertStore';
import { Hono } from 'hono';
import type { SessionStore } from '../../../shared/chat';
import type { SettingsStore } from '../storage/settingsStore';
import type { ArtifactStore } from '../storage/artifactStore';
import type { ProjectStore } from '../storage/projectStore';
import {
  abortChatTurn,
  buildSteerContent,
  drainSteerInbox,
  pushSteer,
  runChatTurn,
} from '../agent/runtime';
import { isSessionTurnLive, resumeAgentTurn } from '../agent/session';
import { answerAsk, answerPermission, pendingAsksForSession, type PermissionDecision } from '../agent/permissions';
import { loadSkills, type Skill } from '../../skills';
import type { LargeValueStore } from '../storage/largeValueStore';
import type { CanvasStore } from '../storage/canvasStore';
import type { ProviderStore } from '../storage/providerStore';
import type { MemoryEventsStore } from '../storage/memoryEventsStore';
import type { ScheduleStore } from '../storage/scheduleStore';

const DECISIONS = new Set<PermissionDecision>(['allow', 'deny', 'allow-session']);

export function createChatRouter(
  sessionStore: SessionStore,
  settingsStore: SettingsStore,
  skillsDirs: string[] = [],
  artifactStore?: ArtifactStore,
  projectStore?: ProjectStore,
  largeValueStore?: LargeValueStore,
  canvas?: { canvasStore?: CanvasStore; dataRoot: string; providerStore?: ProviderStore },
  memoryEventsStore?: MemoryEventsStore,
  scheduleStore?: ScheduleStore,
  artifactReviews?: ArtifactReviewStore,
  /** Summarise an over-long conversation before the turn starts (best effort). */
  beforeTurn?: (sessionId: string) => Promise<unknown>,
  expertStore?: ExpertStore,
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

    const sessionId = c.req.param('id');
    console.info(
      `[chat] request accepted session=${sessionId} chars=${body.text.length} provider=${typeof body.providerId === 'string' ? body.providerId : 'default'} model=${typeof body.model === 'string' ? body.model : 'default'}`,
    );

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

    // A project can set the skill and model its conversations start with. A skill the user picked for this message wins.
    const inSession = projectStore ? await sessionStore.get(sessionId) : null;
    const project = inSession?.projectId && projectStore ? await projectStore.get(inSession.projectId).catch((): null => null) : null;
    const skillId = typeof body.skillId === 'string' && body.skillId.trim() ? body.skillId : project?.defaultSkillId;
    let skill = null;
    const availableSkills = await loadSkills(skillsDirs).catch((): Skill[] => []);
    if (skillId) {
      skill = availableSkills.find((item) => item.id === skillId) ?? null;
    }

    // `@name` at the start of the message hands it to that expert (its own instructions, model and tool limits).
    const expert = expertStore ? findExpertMention(body.text, await expertStore.list().catch((): ExpertAgent[] => [])) : null;

    if (body.regenerate !== true) await beforeTurn?.(sessionId).catch((): void => undefined);

    const response = await runChatTurn({
      sessionStore,
      settingsStore,
      sessionId,
      userText: body.text,
      // The picker is global and always sent, so a project that sets a model is the one place that overrides it.
      providerId: expert?.model ? expert.providerId : project?.defaultModel ? project.defaultModel.providerId : typeof body.providerId === 'string' ? body.providerId : undefined,
      model: expert?.model ?? (project?.defaultModel ? project.defaultModel.model : typeof body.model === 'string' ? body.model : undefined),
      expert,
      mentions,
      skill,
      attachments,
      artifactStore,
      artifactReviews,
      projectStore,
      truncateAfterId: typeof body.truncateAfterId === 'string' ? body.truncateAfterId : undefined,
      regenerate: body.regenerate === true,
      largeValueStore,
      canvasStore: canvas?.canvasStore,
      canvasProviderStore: canvas?.providerStore,
      dataRoot: canvas?.dataRoot,
      memoryEventsStore,
      scheduleStore,
      availableSkills,
    });
    console.info(`[chat] stream opened session=${sessionId} status=${response.status}`);
    return response;
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

  // Steer (插话): park a message in the live turn's inbox — the agent loop
  // injects it at the next step boundary, no interrupt, no new turn. Returns
  // `accepted: false` when no turn is live so the renderer falls back to
  // queueing it.
  router.post('/:id/steer', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: string;
      text?: string;
      mentions?: string[];
    };
    const text = body.text?.trim() ?? '';
    if (!text) return c.json({ error: 'text is required' }, 400);
    if (!isSessionTurnLive(id)) return c.json({ accepted: false });
    pushSteer(id, {
      id: body.id ?? crypto.randomUUID(),
      content: buildSteerContent(canvas?.canvasStore, id, text, body.mentions ?? []),
    });
    return c.json({ accepted: true });
  });

  // Leftover steers when the turn ended before the inbox drained — the
  // renderer moves them into its queue. System notes (jobWatch) are transient
  // and must never park there as if the user typed them.
  router.delete('/:id/steer', (c) => {
    const items = drainSteerInbox(c.req.param('id'))
      .filter((s) => !s.system)
      .map((s) => ({
        id: s.id,
        content: s.content,
      }));
    return c.json({ items });
  });

  router.post('/:id/permissions', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.id !== 'string' || !DECISIONS.has(body.decision)) {
      return c.json({ error: 'id and decision are required' }, 400);
    }
    const ok = answerPermission(body.id, body.decision);
    return c.json({ ok });
  });

  // Unanswered ask cards, including ones restored after an app restart — the
  // renderer fetches these on session open so a pending question never vanishes.
  router.get('/:id/interactions', (c) => {
    return c.json({ interactions: pendingAsksForSession(c.req.param('id')) });
  });

  router.post('/:id/ask', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (typeof body?.id !== 'string' || !body.answers || typeof body.answers !== 'object') {
      return c.json({ error: 'id and answers are required' }, 400);
    }
    const ok = answerAsk(body.id, body.answers as Record<string, string>);
    // `live` tells the renderer whether a suspended turn is still around to
    // consume the answer — false after a restart, when it should fall back to
    // sending the answers as a normal user message.
    return c.json({ ok, live: ok && isSessionTurnLive(c.req.param('id')) });
  });

  return router;
}
