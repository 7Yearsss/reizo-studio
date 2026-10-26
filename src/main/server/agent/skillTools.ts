import { tool } from 'ai';
import { z } from 'zod';
import { autoInvokableSkills, type Skill } from '../../skills';

export const USE_SKILL_TOOL = 'use_skill';

/** What a started skill hands back: its instructions (and accumulated experience), to follow for the rest of the task. */
export function skillInstructions(skill: Skill): string {
  return [
    `Skill "${skill.name}" started. Follow these instructions for the rest of the task:`,
    skill.body,
    skill.experience ? `Accumulated experience for "${skill.name}":\n${skill.experience}` : '',
    'If the instructions declare a "提问"/"Questions" section, collect the missing inputs with ask_user cards before producing output.',
  ].filter(Boolean).join('\n\n');
}

export function createSkillTools(options: { skills: Skill[] }) {
  const usable = new Map(autoInvokableSkills(options.skills).map((s) => [s.id, s]));
  if (usable.size === 0) return {};
  return {
    [USE_SKILL_TOOL]: tool({
      description: 'Start one of the listed skills by id and receive its instructions. Only when the request clearly matches that skill\'s TRIGGER; never for questions about what you can do.',
      inputSchema: z.object({ id: z.string().describe('The skill id from the skills list.') }),
      execute: async ({ id }) => {
        const skill = usable.get(id);
        if (!skill) return { ok: false, error: `No skill "${id}" is available to start. Available: ${[...usable.keys()].join(', ')}` };
        return { ok: true, id: skill.id, instructions: skillInstructions(skill) };
      },
    }),
  };
}
