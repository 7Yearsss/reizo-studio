import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findConfigNames, hasUnresolvedConfig, substituteConfig } from '../../../shared/pluginConfig';
import { inspectPluginDir, installPlugin, listPlugins, loadPluginContributions, setPluginConfig, setPluginEnabled, uninstallPlugin } from './pluginStore';

let tmp: string;
let dataRoot: string;
let source: string;
const SECRET = 'tok-super-secret-123';

async function write(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

async function makePlugin(root: string) {
  await write(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'Crm Pack', version: '1.0.0' }));
  await write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: {
    crm: { command: 'node', args: ['server.js'], env: { API_TOKEN: '${config.API_TOKEN}' } },
    open: { command: 'node', args: ['open.js'] },
  } }));
  await write(path.join(root, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node audit.js --key ${config.AUDIT_KEY}' }] }] } }));
}

async function allFilesText(dir: string): Promise<string> {
  let text = '';
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    text += entry.isDirectory() ? await allFilesText(full) : await readFile(full, 'utf8');
  }
  return text;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'plugin-config-'));
  dataRoot = path.join(tmp, 'data');
  source = path.join(tmp, 'source');
  await makePlugin(source);
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('placeholder helpers', () => {
  it('finds, fills and detects unfilled placeholders', () => {
    expect(findConfigNames('a ${config.A} b ${config.B} ${config.A}')).toEqual(['A', 'B']);
    expect(substituteConfig('x ${config.A} ${config.B}', { A: '1' })).toBe('x 1 ${config.B}');
    expect(hasUnresolvedConfig('x ${config.B}')).toBe(true);
    expect(hasUnresolvedConfig('plain')).toBe(false);
  });
});

describe('plugin credentials', () => {
  it('inspection lists what the pack asks for, as names only', async () => {
    const inspection = await inspectPluginDir(source);
    expect(inspection?.summary.config).toEqual([{ name: 'API_TOKEN', set: false }, { name: 'AUDIT_KEY', set: false }]);
  });

  it('an unconfigured server is not started, the open one is; filling the value starts it — in memory only', async () => {
    await installPlugin(dataRoot, source);
    await setPluginEnabled(dataRoot, 'crm-pack', true);
    let names = (await loadPluginContributions(dataRoot)).mcpServers.map((s) => s.name);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('open');
    expect((await loadPluginContributions(dataRoot)).hooks).toHaveLength(0);

    await setPluginConfig(dataRoot, 'crm-pack', 'API_TOKEN', SECRET);
    await setPluginConfig(dataRoot, 'crm-pack', 'AUDIT_KEY', 'audit-xyz');
    const contributions = await loadPluginContributions(dataRoot);
    names = contributions.mcpServers.map((s) => s.name);
    expect(names).toHaveLength(2);
    const crm = contributions.mcpServers.find((s) => s.name.includes('crm'));
    expect(crm && crm.kind === 'stdio' && crm.env?.API_TOKEN).toBe(SECRET);
    expect(contributions.hooks[0].command).toContain('audit-xyz');
    expect((await listPlugins(dataRoot))[0].config).toEqual([{ name: 'API_TOKEN', set: true }, { name: 'AUDIT_KEY', set: true }]);
  });

  it('the plaintext value is on no disk file; the pack on disk keeps its placeholder', async () => {
    await installPlugin(dataRoot, source);
    await setPluginConfig(dataRoot, 'crm-pack', 'API_TOKEN', SECRET);
    const everything = await allFilesText(dataRoot);
    expect(everything).not.toContain(SECRET);
    expect(everything).toContain('${config.API_TOKEN}');
  });

  it('clearing removes it, uninstalling forgets every credential, bad names are refused', async () => {
    await installPlugin(dataRoot, source);
    await setPluginConfig(dataRoot, 'crm-pack', 'API_TOKEN', SECRET);
    await setPluginConfig(dataRoot, 'crm-pack', 'API_TOKEN', null);
    expect((await listPlugins(dataRoot))[0].config?.[0]).toEqual({ name: 'API_TOKEN', set: false });
    await setPluginConfig(dataRoot, 'crm-pack', 'API_TOKEN', SECRET);
    await uninstallPlugin(dataRoot, 'crm-pack');
    expect(JSON.parse(await readFile(path.join(dataRoot, 'plugin-secrets.json'), 'utf8'))).toEqual({});
    await expect(setPluginConfig(dataRoot, 'crm-pack', 'bad name', 'x')).rejects.toThrow();
    await expect(setPluginConfig(dataRoot, 'nope', 'API_TOKEN', 'x')).rejects.toThrow();
  });
});
