import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { EXPERT_INSTRUCTIONS_MAX, expertIdFor, parseExpert, serializeExpert, type ExpertAgent } from '../../../shared/expertAgent';
import { redactSecrets } from '../../../shared/redactSecrets';
import { writeTextAtomic } from './atomicFile';

export class ExpertValidationError extends Error {}

/** One `<id>.md` per expert under `<dataRoot>/agents`. Only the user creates these files — nothing reads them from a workspace. */
export function createExpertStore(dataRoot: string) {
  const dir = path.join(dataRoot, 'agents');
  const fileFor = (id: string) => path.join(dir, `${id}.md`);

  async function get(id: string): Promise<ExpertAgent | null> {
    if (id !== path.basename(id) || id.includes('..')) return null;
    try {
      return parseExpert(await readFile(fileFor(id), 'utf8'), id);
    } catch {
      return null;
    }
  }

  async function list(): Promise<ExpertAgent[]> {
    const names = await readdir(dir).catch((): string[] => []);
    const experts = await Promise.all(names.filter((n) => n.endsWith('.md')).map((n) => get(n.slice(0, -3))));
    return experts.filter((e): e is ExpertAgent => e !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    list,
    get,
    /** Create or replace. The id comes from the name, so renaming makes a new expert. */
    async save(input: Omit<ExpertAgent, 'id'>): Promise<ExpertAgent> {
      const name = input.name.trim();
      if (!name || name.length > 40 || /[@\s]/.test(name)) throw new ExpertValidationError('名称 1–40 字，不能含空格或 @');
      const instructions = input.instructions.trim();
      if (!instructions) throw new ExpertValidationError('请写明这位专家的职责和做事方式');
      if (instructions.length > EXPERT_INSTRUCTIONS_MAX) throw new ExpertValidationError(`职责说明最多 ${EXPERT_INSTRUCTIONS_MAX} 字`);
      const aliases = input.aliases.map((a) => a.trim()).filter((a) => a && !/[@\s,]/.test(a));
      const expert: ExpertAgent = {
        id: expertIdFor(name), name, aliases, description: input.description.trim(), instructions: redactSecrets(instructions),
        ...(input.providerId?.trim() ? { providerId: input.providerId.trim() } : {}),
        ...(input.model?.trim() ? { model: input.model.trim() } : {}),
        ...(input.allowedTools?.trim() ? { allowedTools: input.allowedTools.trim() } : {}),
        ...(input.maxTurns && input.maxTurns > 0 ? { maxTurns: Math.floor(input.maxTurns) } : {}),
      };
      const taken = (await list()).find((e) => e.id !== expert.id && [e.name, ...e.aliases].some((h) => [expert.name, ...expert.aliases].some((mine) => mine.toLowerCase() === h.toLowerCase())));
      if (taken) throw new ExpertValidationError(`名称或别名与「${taken.name}」冲突`);
      await mkdir(dir, { recursive: true });
      const { id, ...rest } = expert;
      await writeTextAtomic(fileFor(id), serializeExpert(rest));
      return expert;
    },
    async remove(id: string): Promise<boolean> {
      if (!(await get(id))) return false;
      await rm(fileFor(id), { force: true });
      return true;
    },
  };
}

export type ExpertStore = ReturnType<typeof createExpertStore>;
