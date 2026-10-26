import { describe, expect, it } from 'vitest';
import { parseAllowedTools } from '../../../shared/skillToolPolicy';
import { applySkillToolPolicy } from './skillToolFilter';

const mk = () => {
  const ran: string[] = [];
  const t = (name: string) => ({ execute: async (input: Record<string, unknown>) => { ran.push(`${name}:${JSON.stringify(input)}`); return 'ok'; } });
  return { ran, tools: { read_file: t('read_file'), run_command: t('run_command'), write_file: t('write_file'), edit_file: t('edit_file'), ask_user: t('ask_user'), todo_write: t('todo_write') } };
};

describe('applySkillToolPolicy', () => {
  const rules = parseAllowedTools('read_file, run_command(git *)');

  it('withholds unlisted tools but keeps plumbing', () => {
    const { tools } = mk();
    expect(Object.keys(applySkillToolPolicy(tools, rules)).sort()).toEqual(['ask_user', 'read_file', 'run_command', 'todo_write']);
  });

  it('git is allowed, rm is refused before anything runs', async () => {
    const { tools, ran } = mk();
    const filtered = applySkillToolPolicy(tools, rules);
    const run = filtered.run_command.execute as (i: Record<string, unknown>, o: never) => Promise<unknown>;
    await expect(run({ command: 'git status' }, undefined as never)).resolves.toBe('ok');
    expect(() => run({ command: 'rm -rf build' }, undefined as never)).toThrow('不在范围内');
    expect(ran).toEqual(['run_command:{"command":"git status"}']);
  });

  it('no rules means the toolset is untouched', () => {
    const { tools } = mk();
    expect(applySkillToolPolicy(tools, undefined)).toBe(tools);
  });
});
