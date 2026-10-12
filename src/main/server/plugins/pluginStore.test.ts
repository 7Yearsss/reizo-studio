import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectPluginDir, installPlugin, listPlugins, loadPluginContributions, pluginIdFrom, setPluginEnabled, syncPluginSkillsDirs, uninstallPlugin } from './pluginStore';

let tmp: string;
let dataRoot: string;

async function write(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

/** A Claude-Code-layout plugin: manifest, one skill, an MCP server using the root variable, nested hooks. */
async function makeClaudePlugin(root: string, name = 'Code Helper') {
  await write(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '1.2.0', description: 'Helps with code' }));
  await write(path.join(root, 'skills', 'lint-fix', 'SKILL.md'), '---\nname: Lint fix\ndescription: fix lint\n---\nDo it.');
  await write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { tools: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'] } } }));
  await write(path.join(root, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/guard.js', timeout: 5 }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
    },
  }));
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'plugins-'));
  dataRoot = path.join(tmp, 'data');
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('pluginIdFrom', () => {
  it('makes a safe slug', () => {
    expect(pluginIdFrom('Code Helper!')).toBe('code-helper');
    expect(pluginIdFrom('../../etc')).toBe('etc');
    expect(pluginIdFrom('???')).toBe('');
  });
});

describe('inspectPluginDir', () => {
  it('reads a Claude-layout plugin: skills, MCP with the root variable resolved, hooks mapped to our tool names', async () => {
    const src = path.join(tmp, 'src');
    await makeClaudePlugin(src);
    const found = await inspectPluginDir(src);
    expect(found).not.toBeNull();
    const { summary, contributions } = found!;
    expect(summary).toMatchObject({ id: 'code-helper', name: 'Code Helper', version: '1.2.0', format: 'claude', skills: ['lint-fix'] });
    expect(summary.mcpServers).toEqual([{ name: 'code-helpe-tools', kind: 'stdio', target: expect.stringContaining('server.js') }]);
    expect(summary.mcpServers[0].target).not.toContain('${');
    expect(summary.hooks).toEqual([{ event: 'PreToolUse', matcher: 'write_file|edit_file', command: expect.stringContaining('guard.js') }]);
    expect(contributions.hooks[0].timeoutMs).toBe(5000);
    expect(summary.warnings.join(' ')).toContain('Stop');
  });

  it('reads the Codex manifest location and a bare .mcp.json server map', async () => {
    const src = path.join(tmp, 'codex');
    await write(path.join(src, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'docs', description: 'd' }));
    await write(path.join(src, '.mcp.json'), JSON.stringify({ search: { url: 'https://example.com/mcp' } }));
    const found = await inspectPluginDir(src);
    expect(found?.summary.format).toBe('codex');
    expect(found?.summary.mcpServers).toEqual([{ name: 'docs-search', kind: 'http', target: 'https://example.com/mcp' }]);
  });

  it('accepts a bare folder of skills, and rejects folders that are not packs', async () => {
    const skillsOnly = path.join(tmp, 'skills-only');
    await write(path.join(skillsOnly, 'skills', 'a', 'SKILL.md'), '# a');
    expect((await inspectPluginDir(skillsOnly))?.summary).toMatchObject({ name: 'skills-only', format: 'plain', skills: ['a'] });
    const empty = path.join(tmp, 'empty');
    await mkdir(empty, { recursive: true });
    expect(await inspectPluginDir(empty)).toBeNull();
  });

  it('loads Claude slash commands as skills and says plainly that sub-agents are not supported', async () => {
    const src = path.join(tmp, 'cmds');
    await write(path.join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'cmds' }));
    await write(path.join(src, 'commands', 'review.md'), ['---', 'description: review the diff', '---', 'Review $ARGUMENTS'].join('\n'));
    await write(path.join(src, 'agents', 'helper.md'), ['---', 'name: helper', '---', 'You help.'].join('\n'));
    const found = await inspectPluginDir(src);
    expect(found?.summary.skills).toEqual(['review']);
    expect(found?.contributions.skillsDirs).toEqual([path.join(path.resolve(src), 'commands')]);
    expect(found?.summary.warnings.join(' ')).toContain('sub-agents');
  });

  it('refuses manifest paths that escape the plugin folder', async () => {
    const src = path.join(tmp, 'evil');
    await write(path.join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'evil', skills: '../outside', hooks: '../../hooks.json' }));
    const found = await inspectPluginDir(src);
    expect(found?.contributions.skillsDirs).toEqual([]);
    expect(found?.contributions.hooks).toEqual([]);
    expect(found?.summary.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('install, enable, uninstall', () => {
  it('installs disabled, contributes nothing until enabled, then contributes everything', async () => {
    const src = path.join(tmp, 'src');
    await makeClaudePlugin(src);
    const installed = await installPlugin(dataRoot, src);
    expect(installed).toMatchObject({ id: 'code-helper', enabled: false });
    expect(await loadPluginContributions(dataRoot)).toEqual({ skillsDirs: [], mcpServers: [], hooks: [] });

    await setPluginEnabled(dataRoot, 'code-helper', true);
    expect((await listPlugins(dataRoot))[0].enabled).toBe(true);
    const on = await loadPluginContributions(dataRoot);
    expect(on.skillsDirs).toHaveLength(1);
    expect(on.skillsDirs[0]).toContain(path.join('plugins', 'code-helper'));
    expect(on.mcpServers).toHaveLength(1);
    expect(on.hooks).toHaveLength(1);

    await setPluginEnabled(dataRoot, 'code-helper', false);
    expect(await loadPluginContributions(dataRoot)).toEqual({ skillsDirs: [], mcpServers: [], hooks: [] });
  });

  it('reinstalling keeps the on/off state and replaces files; uninstall removes both', async () => {
    const src = path.join(tmp, 'src');
    await makeClaudePlugin(src);
    await installPlugin(dataRoot, src);
    await setPluginEnabled(dataRoot, 'code-helper', true);
    await write(path.join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'Code Helper', version: '2.0.0' }));
    const again = await installPlugin(dataRoot, src);
    expect(again).toMatchObject({ version: '2.0.0', enabled: true });
    await uninstallPlugin(dataRoot, 'code-helper');
    expect(await listPlugins(dataRoot)).toEqual([]);
    expect(JSON.parse(await readFile(path.join(dataRoot, 'plugins-state.json'), 'utf8')).enabled).toEqual([]);
  });

  it('does not copy .git or node_modules, and refuses non-packs and bad ids', async () => {
    const src = path.join(tmp, 'src');
    await makeClaudePlugin(src);
    await write(path.join(src, 'node_modules', 'x', 'index.js'), '1');
    await write(path.join(src, '.git', 'HEAD'), 'ref');
    await installPlugin(dataRoot, src);
    const dest = path.join(dataRoot, 'plugins', 'code-helper');
    await expect(readFile(path.join(dest, 'node_modules', 'x', 'index.js'))).rejects.toThrow();
    await expect(readFile(path.join(dest, '.git', 'HEAD'))).rejects.toThrow();
    const empty = path.join(tmp, 'empty');
    await mkdir(empty, { recursive: true });
    await expect(installPlugin(dataRoot, empty)).rejects.toThrow('不是扩展包');
    await expect(setPluginEnabled(dataRoot, '../etc', true)).rejects.toThrow('Invalid plugin id');
    await expect(uninstallPlugin(dataRoot, '..')).rejects.toThrow('Invalid plugin id');
  });
});

describe('syncPluginSkillsDirs', () => {
  it('replaces only the plugin entries and puts them first', async () => {
    const src = path.join(tmp, 'src');
    await makeClaudePlugin(src);
    await installPlugin(dataRoot, src);
    await setPluginEnabled(dataRoot, 'code-helper', true);
    const dirs = ['/bundled/skills', path.join(dataRoot, 'skills')];
    await syncPluginSkillsDirs(dataRoot, dirs);
    expect(dirs).toHaveLength(3);
    expect(dirs[0]).toContain(path.join('plugins', 'code-helper'));
    await syncPluginSkillsDirs(dataRoot, dirs);
    expect(dirs).toHaveLength(3);
    await setPluginEnabled(dataRoot, 'code-helper', false);
    await syncPluginSkillsDirs(dataRoot, dirs);
    expect(dirs).toEqual(['/bundled/skills', path.join(dataRoot, 'skills')]);
  });
});
