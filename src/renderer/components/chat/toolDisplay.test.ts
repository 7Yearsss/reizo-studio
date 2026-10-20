import { describe, expect, it } from 'vitest';
import {
  toolDiffPreview,
  unwrapCommand,
  sniffCommandIntent,
  toolLabel,
  toolAction,
  toolTarget,
} from './toolDisplay';
import type { ToolCallPart } from '../../../shared/chat';

function part(args: Record<string, unknown> = {}, name = 'edit_file', result?: string): ToolCallPart {
  return { type: 'tool', id: 't1', name, args, result };
}

describe('toolDiffPreview', () => {
  it('returns null when the result has no preview', () => {
    expect(toolDiffPreview(part({ path: 'a.ts' }, 'edit_file', JSON.stringify({ path: 'a.ts', diff: '- x\n+ y' })))).toBeNull();
  });

  it('returns null for a running tool with no result', () => {
    expect(toolDiffPreview(part({ path: 'a.ts' }, 'edit_file', undefined))).toBeNull();
  });

  it('extracts a well-formed before/after preview', () => {
    const preview = { path: 'a.ts', before: 'const x = 1', after: 'const x = 2' };
    expect(toolDiffPreview(part({ path: 'a.ts' }, 'edit_file', JSON.stringify({ replacements: 1, preview })))).toEqual(preview);
  });
});

describe('unwrapCommand', () => {
  it('unwraps PowerShell command wrapper', () => {
    expect(unwrapCommand('powershell -Command "Get-ChildItem -Path \'src\'"')).toBe("Get-ChildItem -Path 'src'");
    expect(unwrapCommand('pwsh -c "git status"')).toBe('git status');
  });

  it('unwraps Bash and Zsh wrappers', () => {
    expect(unwrapCommand('/bin/bash -c "npm test"')).toBe('npm test');
    expect(unwrapCommand('zsh -lc \'git diff\'')).toBe('git diff');
  });

  it('unwraps cmd.exe wrapper', () => {
    expect(unwrapCommand('cmd /c "dir"')).toBe('dir');
  });

  it('leaves clean commands untouched', () => {
    expect(unwrapCommand('git status')).toBe('git status');
  });
});

describe('sniffCommandIntent', () => {
  it('sniffs Git commands accurately', () => {
    const st = sniffCommandIntent('git status');
    expect(st.action).toBe('git');
    expect(st.label).toBe('Git 状态');
    expect(st.target).toBe('检查工作区文件改动');

    const cm = sniffCommandIntent('git commit -m "feat: enhance UI"');
    expect(cm.action).toBe('git');
    expect(cm.label).toBe('Git 提交');
    expect(cm.target).toBe('“feat: enhance UI”');

    const df = sniffCommandIntent('git diff HEAD~1');
    expect(df.action).toBe('git');
    expect(df.label).toBe('Git 对比');
  });

  it('sniffs testing and test runners', () => {
    const vt = sniffCommandIntent('npx vitest run src/renderer/components/chat/CountingNumber.test.tsx');
    expect(vt.action).toBe('test');
    expect(vt.label).toBe('单元测试');
    expect(vt.target).toContain('CountingNumber.test.tsx');

    const nt = sniffCommandIntent('npm test');
    expect(nt.action).toBe('test');
    expect(nt.label).toBe('单元测试');
  });

  it('sniffs build, typecheck, and lint', () => {
    const tc = sniffCommandIntent('npx tsc --noEmit');
    expect(tc.action).toBe('build');
    expect(tc.label).toBe('类型检查');

    const bd = sniffCommandIntent('npm run build');
    expect(bd.action).toBe('build');
    expect(bd.label).toBe('项目构建');

    const lt = sniffCommandIntent('npx eslint .');
    expect(lt.action).toBe('build');
    expect(lt.label).toBe('代码检查');
  });

  it('sniffs package installation', () => {
    const pkg = sniffCommandIntent('npm i lucide-react');
    expect(pkg.action).toBe('install');
    expect(pkg.label).toBe('依赖安装');
    expect(pkg.target).toContain('lucide-react');
  });

  it('sniffs PowerShell search commands', () => {
    const ss = sniffCommandIntent('powershell -Command "Select-String -Path \'src/chatStore.ts\' -Pattern \'composerSeed\'"');
    expect(ss.action).toBe('search');
    expect(ss.label).toBe('搜索代码');
    expect(ss.target).toContain('"composerSeed"');

    const gci = sniffCommandIntent('powershell -Command "Get-ChildItem -Path \'src/renderer\' -Filter \'*presentation*\'"');
    expect(gci.action).toBe('search');
    expect(gci.label).toBe('查找文件');
    expect(gci.target).toContain('"*presentation*"');
  });

  it('sniffs POSIX search commands (grep, rg, find)', () => {
    const gp = sniffCommandIntent('grep -rn "useEffect" src/');
    expect(gp.action).toBe('search');
    expect(gp.label).toBe('搜索代码');
    expect(gp.target).toContain('"useEffect"');

    const fd = sniffCommandIntent('find src -name "*.tsx"');
    expect(fd.action).toBe('search');
    expect(fd.label).toBe('查找文件');
  });

  it('sniffs file reading (cat, Get-Content)', () => {
    const ct = sniffCommandIntent('cat package.json');
    expect(ct.action).toBe('read');
    expect(ct.label).toBe('读取文件');
    expect(ct.target).toBe('package.json');

    const gc = sniffCommandIntent('powershell -Command "Get-Content -Path \'README.md\'"');
    expect(gc.action).toBe('read');
    expect(gc.label).toBe('读取文件');
    expect(gc.target).toBe('README.md');
  });

  it('sniffs script execution (node, python)', () => {
    const nd = sniffCommandIntent('node scripts/dev-kill.mjs');
    expect(nd.action).toBe('run');
    expect(nd.label).toBe('执行脚本');
    expect(nd.target).toBe('dev-kill.mjs');
  });
});

describe('toolLabel, toolAction, toolTarget with sniffed commands', () => {
  it('derives semantic label, action, and target for run_command', () => {
    const p = part({ command: 'git status' }, 'run_command');
    expect(toolLabel('run_command', p)).toBe('Git 状态');
    expect(toolAction('run_command', p)).toBe('git');
    expect(toolTarget(p)).toBe('检查工作区文件改动');
  });

  it('falls back gracefully when command is generic', () => {
    const p = part({ command: 'echo "hello"' }, 'run_command');
    expect(toolAction('run_command', p)).toBe('run');
    expect(toolLabel('run_command', p)).toBe('运行命令');
  });
});
