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
        source: skill.source,
      })),
    });
  });

  return router;
}
