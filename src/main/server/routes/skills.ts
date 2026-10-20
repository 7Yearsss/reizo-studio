import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type { SessionStore } from '../../../shared/chat';
import { loadSkills, type Skill } from '../../skills';
import { applySkillRefinement, proposeSkillRefinement } from '../agent/skillRefiner';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Frontmatter `cover` wins; otherwise the first image in assets/ (sorted). */
async function coverUrlFor(skill: Skill): Promise<string | undefined> {
  let file = skill.cover;
  if (!file) {
    try {
      const names = await readdir(path.join(skill.dir, 'assets'));
      file = names
        .filter((name) => IMAGE_EXTS.has(path.extname(name).toLowerCase()))
        .sort()[0];
    } catch {
      return undefined;
    }
  }
  if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) return undefined;
  try {
    await stat(path.join(skill.dir, 'assets', file));
  } catch {
    return undefined;
  }
  return `/api/skills/${encodeURIComponent(skill.id)}/assets/${encodeURIComponent(file)}`;
}

export function createSkillsRouter(
  dirs: string[],
  options?: {
    dataRoot?: string;
    sessionStore?: SessionStore;
    rewriteText?: (system: string, prompt: string) => Promise<string>;
  },
) {
  const router = new Hono();

  router.get('/', async (c) => {
    const skills = await loadSkills(dirs);
    const coverUrls = await Promise.all(skills.map((skill) => coverUrlFor(skill)));
    return c.json({
      skills: skills.map((skill: Skill, index) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        prompt: skill.prompt,
        category: skill.category,
        source: skill.source,
        coverUrl: coverUrls[index],
      })),
    });
  });

  // Static files bundled inside a skill directory — backs `skill-asset:`
  // URLs on direction cards so a skill can ship preset sample images.
  router.get('/:id/assets/:file', async (c) => {
    const id = c.req.param('id');
    const file = c.req.param('file');
    if (file.includes('/') || file.includes('\\') || file.includes('..')) {
      return c.json({ error: 'invalid file' }, 400);
    }
    const skills = await loadSkills(dirs);
    const skill = skills.find((item) => item.id === id);
    if (!skill) return c.json({ error: 'skill not found' }, 404);
    try {
      const bytes = await readFile(path.join(skill.dir, 'assets', file));
      const ext = file.split('.').pop()?.toLowerCase();
      const type =
        ext === 'png' ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'gif' ? 'image/gif'
        : ext === 'svg' ? 'image/svg+xml'
        : 'application/octet-stream';
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': type, 'cache-control': 'private, max-age=3600' },
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  router.get('/:id', async (c) => {
    const id = c.req.param('id');
    const skills = await loadSkills(dirs);
    const skill = skills.find((item) => item.id === id);
    if (!skill) return c.json({ error: 'skill not found' }, 404);
    return c.json({
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        prompt: skill.prompt,
        body: skill.body,
        category: skill.category,
        source: skill.source,
        coverUrl: await coverUrlFor(skill),
      },
    });
  });

  /**
   * Harness² B4: Propose a self-optimization diff for `SKILL.md` from a completed session's trajectory.
   */
  router.post('/:id/propose-refinement', async (c) => {
    if (!options?.dataRoot || !options?.sessionStore) {
      return c.json({ error: 'skill refinement is not configured' }, 400);
    }
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string };
    if (!body.sessionId) return c.json({ error: 'sessionId is required' }, 400);
    const session = await options.sessionStore.get(body.sessionId);
    if (!session) return c.json({ error: 'session not found' }, 404);
    const skills = await loadSkills(dirs);
    const skill = skills.find((item) => item.id === id);
    if (!skill) return c.json({ error: 'skill not found' }, 404);

    const proposal = await proposeSkillRefinement({
      dataRoot: options.dataRoot,
      skill,
      messages: session.messages,
      rewriteText: options.rewriteText,
    });
    return c.json({ ok: true, proposal });
  });

  /**
   * Harness² B3 + B4: Apply a user-confirmed `SKILL.md` refinement and append to `EXPERIENCE.md` in `<dataRoot>/skills/<id>/`.
   */
  router.post('/:id/apply-refinement', async (c) => {
    if (!options?.dataRoot) {
      return c.json({ error: 'skill refinement is not configured' }, 400);
    }
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      after?: string;
      experienceEntry?: { cue: string; lesson: string; evidence: string; confidence: 'high' | 'medium' } | null;
    };
    if (!body.after) return c.json({ error: 'after markdown is required' }, 400);
    const skills = await loadSkills(dirs);
    const skill = skills.find((item) => item.id === id);
    if (!skill) return c.json({ error: 'skill not found' }, 404);

    try {
      const saved = await applySkillRefinement({
        dataRoot: options.dataRoot,
        skill,
        afterMarkdown: body.after,
        experienceEntry: body.experienceEntry ?? null,
      });
      return c.json({ ok: true, ...saved });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  return router;
}
