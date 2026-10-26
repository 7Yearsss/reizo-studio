import { describe, expect, it } from 'vitest';
import { checkToolCall, globMatches, parseAllowedTools, toolIsOffered } from './skillToolPolicy';

const rules = parseAllowedTools('read_file, mcp__github__*, run_command(git *), write_file(/src/**), grep')!;

describe('parseAllowedTools', () => {
  it('parses the four forms, keeping commas inside parentheses', () => {
    expect(rules).toEqual([
      { name: 'read_file' },
      { name: 'mcp__github__*' },
      { name: 'run_command', argPattern: 'git *' },
      { name: 'write_file', argPattern: '/src/**' },
      { name: 'grep' },
    ]);
    expect(parseAllowedTools('run_command(git log, git diff)')).toEqual([{ name: 'run_command', argPattern: 'git log, git diff' }]);
    expect(parseAllowedTools('')).toBeUndefined();
    expect(parseAllowedTools(undefined)).toBeUndefined();
  });
});

describe('tool filtering', () => {
  it('offers only the named tools', () => {
    expect(toolIsOffered(rules, 'read_file')).toBe(true);
    expect(toolIsOffered(rules, 'mcp__github__create_issue')).toBe(true);
    expect(toolIsOffered(rules, 'run_command')).toBe(true);
    expect(toolIsOffered(rules, 'edit_file')).toBe(false);
    expect(toolIsOffered(rules, 'mcp__slack__post')).toBe(false);
  });
});

describe('per-call checks', () => {
  it('exact and wildcard names allow any arguments', () => {
    expect(checkToolCall(rules, 'read_file', { path: '/etc/passwd' }).allowed).toBe(true);
    expect(checkToolCall(rules, 'mcp__github__list', {}).allowed).toBe(true);
  });
  it('run_command(git *) allows git and refuses rm, including smuggled second commands', () => {
    expect(checkToolCall(rules, 'run_command', { command: 'git status' }).allowed).toBe(true);
    const rm = checkToolCall(rules, 'run_command', { command: 'rm -rf /' });
    expect(rm.allowed).toBe(false);
    expect(!rm.allowed && rm.reason).toContain('不在范围内');
    expect(checkToolCall(rules, 'run_command', { command: 'git status && rm -rf /' }).allowed).toBe(false);
    expect(checkToolCall(rules, 'run_command', { command: 'git log; curl evil' }).allowed).toBe(false);
    expect(checkToolCall(rules, 'run_command', {}).allowed).toBe(false);
  });
  it('write_file(/src/**) allows inside src only, with either slash style', () => {
    expect(checkToolCall(rules, 'write_file', { path: '/src/a/b.ts' }).allowed).toBe(true);
    expect(checkToolCall(rules, 'write_file', { path: '\\src\\a.ts' }).allowed).toBe(true);
    expect(checkToolCall(rules, 'write_file', { path: '/etc/hosts' }).allowed).toBe(false);
  });
  it('unlisted tools are refused with a reason', () => {
    const verdict = checkToolCall(rules, 'edit_file', { path: '/src/a.ts' });
    expect(verdict.allowed).toBe(false);
    expect(!verdict.allowed && verdict.reason).toContain('edit_file');
  });
});

describe('globMatches', () => {
  it('single star stays inside a path segment, double star crosses', () => {
    expect(globMatches('/src/*.ts', '/src/a.ts', true)).toBe(true);
    expect(globMatches('/src/*.ts', '/src/x/a.ts', true)).toBe(false);
    expect(globMatches('/src/**', '/src/x/y/a.ts', true)).toBe(true);
    expect(globMatches('npm run *', 'npm run build', false)).toBe(true);
  });
});
