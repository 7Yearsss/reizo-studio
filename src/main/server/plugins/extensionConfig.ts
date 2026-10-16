import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { HookEntry, McpServerEntry, McpTestResult, NodeEnvStatus } from '../../../shared/extensionConfig';
import { parseHooksConfigDetailed } from '../agent/hooks';
import { connectMcpTools, parseMcpConfig, SERVER_NAME } from '../agent/mcpTools';

/**
 * Read/write of the user-level `mcp.json` and `hooks.json` behind Settings → Extensions.
 * Saving rewrites the file in our own shape; the previous file is kept as `<name>.bak` first.
 */

const mcpFile = (dataRoot: string) => path.join(dataRoot, 'mcp.json');
const hooksFile = (dataRoot: string) => path.join(dataRoot, 'hooks.json');

async function backup(file: string): Promise<void> {
  try { await copyFile(file, `${file}.bak`); } catch { /* nothing to back up */ }
}

function recordOrUndefined(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export async function readMcpEntries(dataRoot: string): Promise<McpServerEntry[]> {
  let json: { mcpServers?: unknown; servers?: unknown } | null;
  try { json = JSON.parse(await readFile(mcpFile(dataRoot), 'utf8')); } catch { return []; }
  const servers = json?.mcpServers ?? json?.servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  const entries: McpServerEntry[] = [];
  for (const [name, value] of Object.entries(servers)) {
    if (!SERVER_NAME.test(name) || !value || typeof value !== 'object') continue;
    const s = value as Record<string, unknown>;
    const disabled = s.disabled === true ? { disabled: true } : {};
    if (typeof s.command === 'string' && s.command.trim()) {
      entries.push({
        name, transport: 'stdio', command: s.command,
        args: Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === 'string') : [],
        env: recordOrUndefined(s.env), ...(typeof s.cwd === 'string' ? { cwd: s.cwd } : {}), ...disabled,
      });
    } else if (typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) {
      entries.push({ name, transport: s.type === 'sse' ? 'sse' : 'http', url: s.url, headers: recordOrUndefined(s.headers), ...disabled });
    }
  }
  return entries;
}

/** Throws a user-readable message for the first problem found. */
export function validateMcpEntries(entries: McpServerEntry[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    if (!SERVER_NAME.test(e.name)) throw new Error(`服务名「${e.name}」不合法：只能用字母、数字和连字符，最长 24 个字符。`);
    if (seen.has(e.name)) throw new Error(`服务名「${e.name}」重复了。`);
    seen.add(e.name);
    if (e.transport === 'stdio' && !e.command?.trim()) throw new Error(`「${e.name}」需要填写启动命令。`);
    if (e.transport !== 'stdio' && !/^https?:\/\/\S+$/i.test(e.url ?? '')) throw new Error(`「${e.name}」的地址必须以 http:// 或 https:// 开头。`);
  }
}

function toFileShape(e: McpServerEntry): Record<string, unknown> {
  const common = e.disabled ? { disabled: true } : {};
  if (e.transport === 'stdio') {
    return { command: e.command?.trim(), args: e.args ?? [], ...(e.env && Object.keys(e.env).length ? { env: e.env } : {}), ...(e.cwd ? { cwd: e.cwd } : {}), ...common };
  }
  return { url: e.url?.trim(), ...(e.transport === 'sse' ? { type: 'sse' } : {}), ...(e.headers && Object.keys(e.headers).length ? { headers: e.headers } : {}), ...common };
}

export async function writeMcpEntries(dataRoot: string, entries: McpServerEntry[]): Promise<void> {
  validateMcpEntries(entries);
  await mkdir(dataRoot, { recursive: true });
  await backup(mcpFile(dataRoot));
  const mcpServers = Object.fromEntries(entries.map((e) => [e.name, toFileShape(e)]));
  await writeFile(mcpFile(dataRoot), `${JSON.stringify({ mcpServers }, null, 2)}\n`, 'utf8');
}

/** Connect one server on its own and report what it exposes. Never touches mcp.json or the trust baseline. */
export async function testMcpEntry(dataRoot: string, entry: McpServerEntry): Promise<McpTestResult> {
  try { validateMcpEntries([entry]); } catch (error) { return { ok: false, tools: [], messages: [(error as Error).message] }; }
  const config = parseMcpConfig(JSON.stringify({ mcpServers: { [entry.name]: toFileShape({ ...entry, disabled: false }) } }))[0];
  if (!config) return { ok: false, tools: [], messages: ['配置无法解析。'] };
  const set = await connectMcpTools({ dataRoot, sessionId: 'settings-test', permissionMode: 'ask', onlyServers: [config], connectTimeoutMs: 20_000 });
  try {
    const tools = Object.entries(set.tools).map(([name, tool]) => ({
      name,
      description: String((tool as { description?: string }).description ?? '').replace(/^\[MCP server[^\]]*\]\s*/, ''),
    }));
    return { ok: tools.length > 0 && set.warnings.length === 0, tools, messages: set.warnings.length ? set.warnings : tools.length === 0 ? ['连接成功，但这个服务没有提供任何工具。'] : [] };
  } finally {
    await set.close();
  }
}

export async function readHookEntries(dataRoot: string): Promise<HookEntry[]> {
  try {
    return parseHooksConfigDetailed(await readFile(hooksFile(dataRoot), 'utf8')).hooks.map((h) => ({
      event: h.event, ...(h.matcher ? { matcher: h.matcher } : {}), command: h.command, timeoutMs: h.timeoutMs,
    }));
  } catch { return []; }
}

export function validateHookEntries(entries: HookEntry[]): void {
  for (const [index, e] of entries.entries()) {
    const label = `第 ${index + 1} 条 Hook`;
    if (e.event !== 'PreToolUse' && e.event !== 'PostToolUse') throw new Error(`${label}：事件类型不支持。`);
    if (!e.command?.trim()) throw new Error(`${label}：需要填写要运行的命令。`);
    if (e.matcher) { try { new RegExp(e.matcher); } catch { throw new Error(`${label}：匹配规则不是合法的正则表达式。`); } }
  }
}

export async function writeHookEntries(dataRoot: string, entries: HookEntry[]): Promise<void> {
  validateHookEntries(entries);
  await mkdir(dataRoot, { recursive: true });
  await backup(hooksFile(dataRoot));
  const hooks = entries.map((e) => ({
    event: e.event,
    ...(e.matcher?.trim() ? { matcher: e.matcher.trim() } : {}),
    command: e.command.trim(),
    ...(typeof e.timeoutMs === 'number' && e.timeoutMs > 0 ? { timeoutMs: Math.round(e.timeoutMs) } : {}),
  }));
  await writeFile(hooksFile(dataRoot), `${JSON.stringify({ hooks }, null, 2)}\n`, 'utf8');
}

const execFileAsync = promisify(execFile);

let cachedNodeStatus: { status: NodeEnvStatus; checkedAt: number } | null = null;
const NODE_STATUS_TTL_MS = 10_000;

export async function checkNodeEnvironment(
  runner?: (cmd: string, args: string[]) => Promise<{ stdout: string }>,
): Promise<NodeEnvStatus> {
  const now = Date.now();
  if (!runner && cachedNodeStatus && now - cachedNodeStatus.checkedAt < NODE_STATUS_TTL_MS) {
    return cachedNodeStatus.status;
  }
  try {
    const run = runner ?? ((cmd, args) => execFileAsync(cmd, args, { timeout: 3000, windowsHide: true }));
    const { stdout } = await run('node', ['--version']);
    const version = stdout.trim();
    const status: NodeEnvStatus = { available: Boolean(version), ...(version ? { version } : {}) };
    if (!runner) cachedNodeStatus = { status, checkedAt: now };
    return status;
  } catch {
    const status: NodeEnvStatus = { available: false };
    if (!runner) cachedNodeStatus = { status, checkedAt: now };
    return status;
  }
}

export function resetNodeEnvironmentCacheForTests(): void {
  cachedNodeStatus = null;
}

