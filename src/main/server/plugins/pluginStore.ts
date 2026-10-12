import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PluginSummary } from '../../../shared/plugins';
import { parseHooksConfigDetailed, type HookSpec } from '../agent/hooks';
import { parseMcpConfig, type McpServerConfig } from '../agent/mcpTools';

/**
 * Extension packs: a folder with skills, MCP servers and hooks, in the Claude Code / Codex layout
 *
 *   .claude-plugin/plugin.json | .codex-plugin/plugin.json   { name, version?, description?, skills?, mcpServers?, hooks? }
 *   skills/<id>/SKILL.md      .mcp.json      hooks/hooks.json
 *
 * Installed copies live in `<dataRoot>/plugins/<id>/`; which ones are on is `<dataRoot>/plugins-state.json`.
 * New installs start DISABLED: enabling is the moment the user agrees to what the pack will run.
 */

const MANIFESTS: Array<{ file: string; format: PluginSummary['format'] }> = [
  { file: '.claude-plugin/plugin.json', format: 'claude' },
  { file: '.codex-plugin/plugin.json', format: 'codex' },
  { file: 'plugin.json', format: 'plain' },
];
const ROOT_VARS = /\$\{(?:CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|PLUGIN_ROOT)\}/g;

export interface PluginContributions {
  skillsDirs: string[];
  mcpServers: McpServerConfig[];
  hooks: HookSpec[];
}

interface Inspection {
  summary: Omit<PluginSummary, 'enabled'>;
  contributions: PluginContributions;
}

const pluginsDir = (dataRoot: string) => path.join(dataRoot, 'plugins');
const stateFile = (dataRoot: string) => path.join(dataRoot, 'plugins-state.json');

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** A path from a manifest, resolved inside the plugin dir; anything escaping it is refused. */
function insideDir(root: string, relative: string): string | null {
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

export function pluginIdFrom(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; }
}

function describeTarget(server: McpServerConfig): string {
  return server.kind === 'stdio' ? [server.command, ...server.args].join(' ') : server.url;
}

/** `<plugin>-<server>`, kept inside the 24-char server-name budget MCP config enforces. */
function pluginServerName(pluginId: string, server: string): string {
  return `${pluginId.slice(0, 10)}-${server}`.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 24);
}

export async function inspectPluginDir(dir: string): Promise<Inspection | null> {
  const root = path.resolve(dir);
  let manifest: Record<string, unknown> = {};
  let format: PluginSummary['format'] = 'plain';
  let hasManifest = false;
  for (const candidate of MANIFESTS) {
    const parsed = await readJson(path.join(root, candidate.file));
    if (parsed && typeof parsed === 'object') { manifest = parsed as Record<string, unknown>; format = candidate.format; hasManifest = true; break; }
  }
  const skillsDir = path.join(root, 'skills');
  if (!hasManifest && !(await exists(skillsDir))) return null;

  const name = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : path.basename(root);
  const id = pluginIdFrom(name);
  if (!id) return null;
  const warnings: string[] = [];

  // Skills.
  const skillsPath = typeof manifest.skills === 'string' ? insideDir(root, manifest.skills) : skillsDir;
  if (typeof manifest.skills === 'string' && !skillsPath) warnings.push('The manifest points "skills" outside the plugin folder; ignored.');
  const skillsDirs: string[] = [];
  const skillNames: string[] = [];
  if (skillsPath && (await exists(skillsPath))) {
    skillsDirs.push(skillsPath);
    for (const entry of await readdir(skillsPath, { withFileTypes: true })) {
      if (entry.isDirectory() && (await exists(path.join(skillsPath, entry.name, 'SKILL.md')))) skillNames.push(entry.name);
      else if (entry.isFile() && entry.name.endsWith('.md')) skillNames.push(entry.name.replace(/\.md$/i, ''));
    }
  }

  // MCP servers: inline object, a path, or the default `.mcp.json`.
  let mcpRaw: string | undefined;
  const mcpField = manifest.mcpServers;
  if (mcpField && typeof mcpField === 'object') mcpRaw = JSON.stringify({ mcpServers: mcpField });
  else {
    const mcpPath = typeof mcpField === 'string' ? insideDir(root, mcpField) : path.join(root, '.mcp.json');
    if (typeof mcpField === 'string' && !mcpPath) warnings.push('The manifest points "mcpServers" outside the plugin folder; ignored.');
    if (mcpPath) { try { mcpRaw = await readFile(mcpPath, 'utf8'); } catch { /* none */ } }
  }
  let mcpServers: McpServerConfig[] = [];
  if (mcpRaw) {
    const substituted = mcpRaw.replace(ROOT_VARS, () => root.replace(/\\/g, '/'));
    let parsed = parseMcpConfig(substituted);
    if (parsed.length === 0) {
      // `.mcp.json` may be a bare map of servers without the `mcpServers` wrapper.
      try { parsed = parseMcpConfig(JSON.stringify({ mcpServers: JSON.parse(substituted) })); } catch { /* not JSON */ }
    }
    mcpServers = parsed.map((s) => ({ ...s, name: pluginServerName(id, s.name), ...(s.kind === 'stdio' && !s.cwd ? { cwd: root } : {}) }) as McpServerConfig);
  }

  // Hooks: inline object, a path, or the default `hooks/hooks.json`.
  let hooksRaw: string | undefined;
  const hooksField = manifest.hooks;
  if (hooksField && typeof hooksField === 'object' && !Array.isArray(hooksField)) hooksRaw = JSON.stringify({ hooks: hooksField });
  else {
    const hooksPath = typeof hooksField === 'string' ? insideDir(root, hooksField) : path.join(root, 'hooks', 'hooks.json');
    if (typeof hooksField === 'string' && !hooksPath) warnings.push('The manifest points "hooks" outside the plugin folder; ignored.');
    if (hooksPath) { try { hooksRaw = await readFile(hooksPath, 'utf8'); } catch { /* none */ } }
  }
  let hooks: HookSpec[] = [];
  if (hooksRaw) {
    const parsed = parseHooksConfigDetailed(hooksRaw.replace(ROOT_VARS, () => root.replace(/\\/g, '/')));
    hooks = parsed.hooks;
    if (parsed.unsupportedEvents.length) warnings.push(`Hook events Reizo does not support are ignored: ${parsed.unsupportedEvents.join(', ')}.`);
  }

  return {
    summary: {
      id,
      name,
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
      description: typeof manifest.description === 'string' ? manifest.description : undefined,
      format,
      skills: skillNames.sort(),
      mcpServers: mcpServers.map((s) => ({ name: s.name, kind: s.kind, target: describeTarget(s) })),
      hooks: hooks.map((h) => ({ event: h.event, ...(h.matcher ? { matcher: h.matcher } : {}), command: h.command })),
      warnings,
    },
    contributions: { skillsDirs, mcpServers, hooks },
  };
}

async function readEnabled(dataRoot: string): Promise<Set<string>> {
  const parsed = await readJson(stateFile(dataRoot));
  const list = (parsed as { enabled?: unknown } | undefined)?.enabled;
  return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
}

async function writeEnabled(dataRoot: string, enabled: Set<string>): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  await writeFile(stateFile(dataRoot), `${JSON.stringify({ enabled: [...enabled].sort() }, null, 2)}\n`, 'utf8');
}

async function installedDirs(dataRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(pluginsDir(dataRoot), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(pluginsDir(dataRoot), e.name));
  } catch { return []; }
}

export async function listPlugins(dataRoot: string): Promise<PluginSummary[]> {
  const enabled = await readEnabled(dataRoot);
  const result: PluginSummary[] = [];
  for (const dir of await installedDirs(dataRoot)) {
    const inspection = await inspectPluginDir(dir);
    // The folder name is the identity (`installPlugin` names it), so state keys stay stable.
    if (inspection) result.push({ ...inspection.summary, id: path.basename(dir), enabled: enabled.has(path.basename(dir)) });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Copy a plugin folder in. Replaces an existing copy of the same plugin but keeps its on/off state; new ones start off. */
export async function installPlugin(dataRoot: string, sourceDir: string): Promise<PluginSummary> {
  const inspection = await inspectPluginDir(sourceDir);
  if (!inspection) throw new Error('这个文件夹不是扩展包：需要 plugin.json（.claude-plugin 或 .codex-plugin 下），或者一个 skills 目录。');
  const id = inspection.summary.id;
  const dest = path.join(pluginsDir(dataRoot), id);
  if (path.resolve(sourceDir) === path.resolve(dest)) throw new Error('这个扩展包已经安装在这里了。');
  await mkdir(pluginsDir(dataRoot), { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await cp(sourceDir, dest, { recursive: true, filter: (src) => path.basename(src) !== '.git' && path.basename(src) !== 'node_modules' });
  const enabled = await readEnabled(dataRoot);
  const installed = (await listPlugins(dataRoot)).find((p) => p.id === id);
  if (!installed) throw new Error('安装后无法读取这个扩展包。');
  return { ...installed, enabled: enabled.has(id) };
}

export async function setPluginEnabled(dataRoot: string, id: string, on: boolean): Promise<void> {
  assertPluginId(id);
  if (!(await exists(path.join(pluginsDir(dataRoot), id)))) throw new Error(`没有安装扩展包 ${id}`);
  const enabled = await readEnabled(dataRoot);
  if (on) enabled.add(id); else enabled.delete(id);
  await writeEnabled(dataRoot, enabled);
}

export async function uninstallPlugin(dataRoot: string, id: string): Promise<void> {
  assertPluginId(id);
  await rm(path.join(pluginsDir(dataRoot), id), { recursive: true, force: true });
  const enabled = await readEnabled(dataRoot);
  if (enabled.delete(id)) await writeEnabled(dataRoot, enabled);
}

function assertPluginId(id: string): void {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('Invalid plugin id');
}

/** Everything the enabled packs add to a turn. Disabled or unreadable packs contribute nothing. */
export async function loadPluginContributions(dataRoot: string | undefined): Promise<PluginContributions> {
  const empty: PluginContributions = { skillsDirs: [], mcpServers: [], hooks: [] };
  if (!dataRoot) return empty;
  const enabled = await readEnabled(dataRoot);
  if (enabled.size === 0) return empty;
  const total: PluginContributions = { skillsDirs: [], mcpServers: [], hooks: [] };
  for (const dir of await installedDirs(dataRoot)) {
    if (!enabled.has(path.basename(dir))) continue;
    const inspection = await inspectPluginDir(dir);
    if (!inspection) continue;
    total.skillsDirs.push(...inspection.contributions.skillsDirs);
    total.mcpServers.push(...inspection.contributions.mcpServers);
    total.hooks.push(...inspection.contributions.hooks);
  }
  return total;
}

/** Keep the shared skills-dir list in step with the enabled packs (the list is read on every skills request). */
export async function syncPluginSkillsDirs(dataRoot: string, skillsDirs: string[]): Promise<void> {
  const prefix = pluginsDir(dataRoot) + path.sep;
  for (let i = skillsDirs.length - 1; i >= 0; i--) if (path.resolve(skillsDirs[i]).startsWith(prefix)) skillsDirs.splice(i, 1);
  // Packs go first so bundled and user skills with the same id win over a pack's.
  skillsDirs.unshift(...(await loadPluginContributions(dataRoot)).skillsDirs);
}
