import { Hono } from 'hono';
import { loadSkills, type Skill } from '../../skills';

export function createSkillsRouter(dirs: string[]) {
  const router = new Hono();

  router.get('/', async (c) => {
    const skills = await loadSkills(dirs);
    return c.json({
      skills: skills.map((skill: Skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        prompt: skill.prompt,
        source: skill.source,
      })),
    });
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
      },
    });
  });

  return router;
}
