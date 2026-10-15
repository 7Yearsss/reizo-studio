import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { CatalogSecretField, McpCatalogItem, McpCatalogPage, PluginCatalog, PluginCatalogItem } from '../../../shared/catalog';
import type { PluginSummary } from '../../../shared/plugins';
import { installPlugin } from './pluginStore';

/**
 * Discover catalogs: the official MCP registry and Anthropic's Claude plugin marketplace. Both are
 * public, so this only reads. Plugins are fetched as GitHub zips (no git needed) and handed to the same
 * `installPlugin` as a folder import: they land disabled, and enabling shows what they would run.
 */

type Fetch = typeof globalThis.fetch;

const MCP_REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const MARKETPLACE_REPO = { owner: 'anthropics', repo: 'claude-plugins-official', ref: 'main' };
const MARKETPLACE_URL = `https://raw.githubusercontent.com/${MARKETPLACE_REPO.owner}/${MARKETPLACE_REPO.repo}/${MARKETPLACE_REPO.ref}/.claude-plugin/marketplace.json`;
const FETCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const MAX_ZIP_BYTES = 60 * 1024 * 1024;
const MAX_FILES = 5_000;
const CACHE_MS = 10 * 60 * 1000;

/** A GitHub owner's avatar; GitHub serves these without auth for any user or org. */
export function githubAvatar(owner: string): string {
  return `https://github.com/${encodeURIComponent(owner)}.png?size=80`;
}

function githubOwnerOf(url: unknown): string | null {
  const match = typeof url === 'string' ? /github\.com\/([\w.-]+)(?:\/|$)/i.exec(url) : null;
  return match ? match[1] : null;
}

function httpUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value) ? value : null;
}

/** Registry-provided icons first, then the repo owner's avatar, then the site's own favicon. */
function mcpIcons(server: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const icon of Array.isArray(server.icons) ? (server.icons as Array<Record<string, unknown>>) : []) {
    const src = httpUrl(icon?.src);
    if (src) urls.push(src);
  }
  const owner = githubOwnerOf((server.repository as { url?: unknown } | undefined)?.url);
  if (owner) urls.push(githubAvatar(owner));
  const site = httpUrl(server.websiteUrl);
  if (site) { try { urls.push(`${new URL(site).origin}/favicon.ico`); } catch { /* not a URL */ } }
  return [...new Set(urls)];
}

// --- MCP registry ---------------------------------------------------------------------------------

function fields(raw: unknown): CatalogSecretField[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogSecretField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    if (typeof f.name !== 'string' || !f.name) continue;
    out.push({ name: f.name, ...(typeof f.description === 'string' ? { description: f.description } : {}), required: f.isRequired === true, secret: f.isSecret === true });
  }
  return out;
}

/** One registry entry -> something we can install, or null when we have no way to run it (yet). */
export function parseMcpRegistryServer(raw: unknown): McpCatalogItem | null {
  const server = (raw as { server?: Record<string, unknown> } | null)?.server;
  if (!server || typeof server.name !== 'string') return null;
  const base = {
    id: server.name,
    title: typeof server.title === 'string' && server.title ? server.title : server.name,
    description: typeof server.description === 'string' ? server.description : '',
    icons: mcpIcons(server),
    ...(typeof server.websiteUrl === 'string' ? { website: server.websiteUrl } : {}),
    ...(typeof server.version === 'string' ? { version: server.version } : {}),
  };
  // Hosted servers first: nothing to install locally. URL templates ("{tenant}") can't be filled in a one-click add.
  for (const remote of Array.isArray(server.remotes) ? (server.remotes as Array<Record<string, unknown>>) : []) {
    const url = remote.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || /[{}]/.test(url)) continue;
    if (remote.type === 'streamable-http') return { ...base, install: { kind: 'remote', transport: 'http', url, headers: fields(remote.headers) } };
    if (remote.type === 'sse') return { ...base, install: { kind: 'remote', transport: 'sse', url, headers: fields(remote.headers) } };
  }
  for (const pkg of Array.isArray(server.packages) ? (server.packages as Array<Record<string, unknown>>) : []) {
    const transport = (pkg.transport as { type?: unknown } | undefined)?.type;
    if (pkg.registryType === 'npm' && transport === 'stdio' && typeof pkg.identifier === 'string') {
      return { ...base, install: { kind: 'npm', identifier: pkg.identifier, ...(typeof pkg.version === 'string' ? { version: pkg.version } : {}), env: fields(pkg.environmentVariables) } };
    }
  }
  return null;
}

export async function searchMcpRegistry(options: { search?: string; cursor?: string; limit?: number; fetchImpl?: Fetch } = {}): Promise<McpCatalogPage> {
  const params = new URLSearchParams({ version: 'latest', limit: String(options.limit ?? 30) });
  if (options.search?.trim()) params.set('search', options.search.trim());
  if (options.cursor) params.set('cursor', options.cursor);
  const res = await (options.fetchImpl ?? fetch)(`${MCP_REGISTRY}?${params}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`MCP 注册表请求失败（HTTP ${res.status}）`);
  const json = (await res.json()) as { servers?: unknown[]; metadata?: { nextCursor?: unknown } };
  const items = (json.servers ?? []).flatMap((entry): McpCatalogItem[] => { const item = parseMcpRegistryServer(entry); return item ? [item] : []; });
  const next = json.metadata?.nextCursor;
  return { items, ...(typeof next === 'string' && next ? { nextCursor: next } : {}) };
}

// --- Claude plugin marketplace ----------------------------------------------------------------------

export interface GithubSource { owner: string; repo: string; ref: string; subdir?: string }

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** Where a marketplace entry lives. Only GitHub-hosted plugins are supported; anything else is skipped. */
export function resolvePluginSource(source: unknown): GithubSource | null {
  if (typeof source === 'string') {
    const subdir = source.replace(/^\.\//, '').replace(/\/+$/, '');
    if (subdir.split('/').includes('..')) return null;
    return { ...MARKETPLACE_REPO, ...(subdir && subdir !== '.' ? { subdir } : {}) };
  }
  if (!source || typeof source !== 'object') return null;
  const s = source as Record<string, unknown>;
  const ref = typeof s.sha === 'string' && s.sha ? s.sha : typeof s.ref === 'string' && s.ref ? s.ref : 'HEAD';
  let repo: { owner: string; repo: string } | null = null;
  if (typeof s.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(s.repo)) { const [owner, name] = s.repo.split('/'); repo = { owner, repo: name }; }
  else if (typeof s.url === 'string') repo = parseGithubUrl(s.url);
  if (!repo) return null;
  const subdir = typeof s.path === 'string' ? s.path.replace(/^\.\//, '').replace(/\/+$/, '') : '';
  if (subdir.split('/').includes('..')) return null;
  return { ...repo, ref, ...(subdir ? { subdir } : {}) };
}

interface MarketplaceEntry { item: PluginCatalogItem; source: GithubSource }

export function parseMarketplace(json: unknown): { name: string; entries: MarketplaceEntry[] } {
  const root = json as { name?: unknown; plugins?: unknown } | null;
  const entries: MarketplaceEntry[] = [];
  for (const raw of Array.isArray(root?.plugins) ? (root?.plugins as Array<Record<string, unknown>>) : []) {
    if (!raw || typeof raw.name !== 'string') continue;
    const source = resolvePluginSource(raw.source);
    if (!source) continue;
    entries.push({
      source,
      item: {
        id: raw.name,
        name: raw.name,
        title: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : raw.name,
        icons: [githubAvatar(source.owner)],
        description: typeof raw.description === 'string' ? raw.description : '',
        ...(typeof raw.category === 'string' ? { category: raw.category } : {}),
        ...((raw.author as { name?: unknown } | undefined)?.name && typeof (raw.author as { name: unknown }).name === 'string' ? { author: (raw.author as { name: string }).name } : {}),
        ...(typeof raw.homepage === 'string' ? { homepage: raw.homepage } : {}),
        repo: `${source.owner}/${source.repo}`,
      },
    });
  }
  return { name: typeof root?.name === 'string' ? root.name : 'marketplace', entries };
}

let cache: { at: number; name: string; entries: MarketplaceEntry[] } | null = null;

async function loadMarketplace(fetchImpl: Fetch = fetch): Promise<{ name: string; entries: MarketplaceEntry[] }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const res = await fetchImpl(MARKETPLACE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`插件目录请求失败（HTTP ${res.status}）`);
  const parsed = parseMarketplace(await res.json());
  cache = { at: Date.now(), ...parsed };
  return parsed;
}

export function resetCatalogCacheForTests(): void { cache = null; }

export async function fetchPluginCatalog(fetchImpl?: Fetch): Promise<PluginCatalog> {
  const { name, entries } = await loadMarketplace(fetchImpl);
  return { marketplace: name, items: entries.map((e) => e.item) };
}

/** Download a GitHub zip and write just the plugin's folder (the subdir, or the whole repo) into `destDir`. */
export async function downloadGithubSource(source: GithubSource, destDir: string, fetchImpl: Fetch = fetch): Promise<number> {
  const url = `https://codeload.github.com/${source.owner}/${source.repo}/zip/${encodeURIComponent(source.ref)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error('插件包过大');

  // GitHub zips wrap everything in "<repo>-<ref>/"; keep only the plugin's subtree, with that prefix stripped.
  const wanted = source.subdir ? `${source.subdir}/` : '';
  const files = unzipSync(bytes, {
    filter: (file) => {
      const inner = file.name.slice(file.name.indexOf('/') + 1);
      return !file.name.endsWith('/') && inner.startsWith(wanted);
    },
  });
  const root = path.resolve(destDir);
  let count = 0;
  for (const [name, data] of Object.entries(files)) {
    const inner = name.slice(name.indexOf('/') + 1).slice(wanted.length);
    const normalized = path.posix.normalize(inner);
    if (!normalized || normalized.startsWith('..') || normalized.startsWith('/') || path.isAbsolute(normalized)) continue;
    const target = path.resolve(root, normalized);
    if (target !== root && !target.startsWith(root + path.sep)) continue;
    if (++count > MAX_FILES) throw new Error('插件包内容异常');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  if (count === 0) throw new Error('在仓库里没有找到这个插件的文件');
  return count;
}

/** Fetch a catalog plugin and install it (disabled) like a folder import. */
export async function installCatalogPlugin(dataRoot: string, id: string, fetchImpl?: Fetch): Promise<PluginSummary> {
  const { entries } = await loadMarketplace(fetchImpl);
  const entry = entries.find((e) => e.item.id === id);
  if (!entry) throw new Error(`目录里没有插件 ${id}`);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'reizo-plugin-'));
  try {
    await downloadGithubSource(entry.source, tmp, fetchImpl);
    return await installPlugin(dataRoot, tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
