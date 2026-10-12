import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { appendHookNote, createHookRunner, interpretHookResult, matchingHooks, parseHooksConfig, wrapToolsWithHooks, type HookSpec } from './hooks';

const node = (script: string) => `node -e "${script.replace(/"/g, '\\"')}"`;
const spec = (event: HookSpec['event'], command: string, extra: Partial<HookSpec> = {}): HookSpec => ({ event, command, timeoutMs: 10_000, ...extra });

describe('parseHooksConfig', () => {
  it('keeps valid entries and drops malformed ones', () => {
    const hooks = parseHooksConfig(JSON.stringify({
      hooks: [
        { event: 'PreToolUse', matcher: 'edit_file|write_file', command: 'echo hi', timeoutMs: 500 },
        { event: 'PostToolUse', command: 'echo done' },
        { event: 'Nope', command: 'x' },
        { event: 'PreToolUse', command: '   ' },
        { event: 'PreToolUse', matcher: '(', command: 'x' },
        'junk',
      ],
    }));
    expect(hooks).toEqual([
      { event: 'PreToolUse', matcher: 'edit_file|write_file', command: 'echo hi', timeoutMs: 500 },
      { event: 'PostToolUse', command: 'echo done', timeoutMs: 10_000 },
    ]);
  });
  it('caps the timeout and tolerates invalid JSON', () => {
    expect(parseHooksConfig(JSON.stringify({ hooks: [{ event: 'PreToolUse', command: 'x', timeoutMs: 9e9 }] }))[0].timeoutMs).toBe(60_000);
    expect(parseHooksConfig('{ not json')).toEqual([]);
  });
});

describe('matchingHooks', () => {
  const hooks = [spec('PreToolUse', 'a', { matcher: 'edit_file|write_file' }), spec('PreToolUse', 'b'), spec('PostToolUse', 'c')];
  it('matches the whole tool name, not a substring', () => {
    expect(matchingHooks(hooks, 'PreToolUse', 'edit_file').map((h) => h.command)).toEqual(['a', 'b']);
    expect(matchingHooks(hooks, 'PreToolUse', 'edit_file_extra').map((h) => h.command)).toEqual(['b']);
    expect(matchingHooks(hooks, 'PostToolUse', 'grep').map((h) => h.command)).toEqual(['c']);
  });
});

describe('interpretHookResult', () => {
  it('exit 2 blocks with stderr as the reason', () => {
    expect(interpretHookResult({ code: 2, stdout: '', stderr: 'no secrets\n' }).block).toBe('no secrets');
  });
  it('exit 0 with a JSON decision blocks, and additionalContext becomes a note', () => {
    expect(interpretHookResult({ code: 0, stdout: '{"decision":"block","reason":"nope"}', stderr: '' }).block).toBe('nope');
    expect(interpretHookResult({ code: 0, stdout: '{"additionalContext":"lint ok"}', stderr: '' })).toEqual({ note: 'lint ok' });
  });
  it('never blocks on plain output, other exit codes, or a timeout', () => {
    expect(interpretHookResult({ code: 0, stdout: 'hello', stderr: '' })).toEqual({});
    expect(interpretHookResult({ code: 1, stdout: '', stderr: 'boom' })).toEqual({});
    expect(interpretHookResult({ code: 2, stdout: '', stderr: 'late', timedOut: true })).toEqual({});
  });
});

describe('appendHookNote', () => {
  it('keeps the shape of string and object results', () => {
    expect(appendHookNote('ok', 'n')).toBe('ok\n\n[hook] n');
    expect(appendHookNote({ ok: true }, 'n')).toEqual({ ok: true, hookNote: 'n' });
    expect(appendHookNote([1], 'n')).toEqual([1]);
  });
});

describe('hook runner (real processes)', () => {
  const cwd = os.tmpdir();
  it('is null with no hooks so the tools stay untouched', () => {
    expect(createHookRunner({ hooks: [], sessionId: 's', cwd })).toBeNull();
  });
  it('passes the payload on stdin and blocks on exit code 2', async () => {
    const runner = createHookRunner({
      hooks: [spec('PreToolUse', node('let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>{const j=JSON.parse(d);console.error(j.toolName+\':\'+j.toolInput.path);process.exit(2)})'))],
      sessionId: 's',
      cwd,
    }) as NonNullable<ReturnType<typeof createHookRunner>>;
    await expect(runner.pre('write_file', { path: '.env' })).rejects.toThrow('Blocked by a user hook: write_file:.env');
  });
  it('lets the call through when the hook exits 0 or crashes', async () => {
    const runner = createHookRunner({ hooks: [spec('PreToolUse', node('process.exit(0)')), spec('PreToolUse', node('process.exit(1)')), spec('PreToolUse', 'definitely-not-a-command-xyz')], sessionId: 's', cwd }) as NonNullable<ReturnType<typeof createHookRunner>>;
    await expect(runner.pre('grep', {})).resolves.toBeUndefined();
  });
  it('gives up on a hook that hangs instead of stalling the turn', async () => {
    const runner = createHookRunner({ hooks: [spec('PreToolUse', node('setTimeout(()=>{},60000)'), { timeoutMs: 300 })], sessionId: 's', cwd }) as NonNullable<ReturnType<typeof createHookRunner>>;
    const started = Date.now();
    await expect(runner.pre('grep', {})).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
  it('returns a PostToolUse note from stdout JSON', async () => {
    const runner = createHookRunner({ hooks: [spec('PostToolUse', node('console.log(JSON.stringify({additionalContext:\'checked\'}))'))], sessionId: 's', cwd }) as NonNullable<ReturnType<typeof createHookRunner>>;
    expect(await runner.post('edit_file', {}, 'ok')).toBe('checked');
  });
});

describe('wrapToolsWithHooks', () => {
  const cwd = os.tmpdir();
  it('blocks before execute, annotates after, and skips non-executable tools', async () => {
    let ran = 0;
    const tools = {
      guarded: { description: 'g', execute: async () => { ran += 1; return 'done'; } },
      passive: { description: 'no execute' },
    };
    const blocking = wrapToolsWithHooks(tools, createHookRunner({ hooks: [spec('PreToolUse', node('process.exit(2)'), { matcher: 'guarded' })], sessionId: 's', cwd }));
    await expect((blocking.guarded as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute({}, {})).rejects.toThrow('Blocked by a user hook');
    expect(ran).toBe(0);
    expect(blocking.passive).toBe(tools.passive);

    const noting = wrapToolsWithHooks(tools, createHookRunner({ hooks: [spec('PostToolUse', node('console.log(JSON.stringify({additionalContext:\'fmt ok\'}))'))], sessionId: 's', cwd }));
    expect(await (noting.guarded as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute({}, {})).toBe('done\n\n[hook] fmt ok');
    expect(ran).toBe(1);
  });
  it('does not run PostToolUse when the tool throws (e.g. awaiting approval)', async () => {
    const tools = { gated: { execute: async () => { throw new Error('approval required'); } } };
    const marker = spec('PostToolUse', node('console.log(JSON.stringify({additionalContext:\'should not run\'}))'));
    const wrapped = wrapToolsWithHooks(tools, createHookRunner({ hooks: [marker], sessionId: 's', cwd }));
    await expect((wrapped.gated as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute({}, {})).rejects.toThrow('approval required');
  });
});
