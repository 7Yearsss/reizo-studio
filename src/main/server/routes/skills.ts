import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { loadSkills, type Skill } from '../../skills';

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

export function createSkillsRouter(dirs: string[]) {
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
        source: skill.source,
        coverUrl: await coverUrlFor(skill),
      },
    });
  });

  return router;
}
