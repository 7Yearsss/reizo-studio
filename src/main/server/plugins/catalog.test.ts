import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mcpCatalogDraft, suggestServerName } from '../../../shared/catalog';
import { listPlugins } from './pluginStore';
import { downloadGithubSource, fetchPluginCatalog, installCatalogPlugin, parseMarketplace, parseMcpRegistryServer, resetCatalogCacheForTests, resolvePluginSource, searchMcpRegistry } from './catalog';

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

describe('parseMcpRegistryServer', () => {
  it('prefers a hosted streamable-http remote and carries its header requirements', () => {
    const item = parseMcpRegistryServer({ server: {
      name: 'ai.example/hosted', title: 'Hosted', description: 'd', version: '1.0.0',
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', isRequired: true, isSecret: true, description: 'key' }] }],
      packages: [{ registryType: 'npm', identifier: 'x', transport: { type: 'stdio' } }],
    } });
    expect(item?.install).toEqual({ kind: 'remote', transport: 'http', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', description: 'key', required: true, secret: true }] });
  });

  it('falls back to an npm stdio package with its env vars', () => {
    const item = parseMcpRegistryServer({ server: {
      name: 'io.x/pkg', description: 'd',
      packages: [{ registryType: 'npm', identifier: '@x/srv', version: '2.1.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'API_KEY', isRequired: true, isSecret: true }] }],
    } });
    expect(item?.title).toBe('io.x/pkg');
    expect(item?.install).toEqual({ kind: 'npm', identifier: '@x/srv', version: '2.1.0', env: [{ name: 'API_KEY', required: true, secret: true }] });
  });

  it('skips servers it cannot run: URL templates, pypi/docker packages, nothing at all', () => {
    expect(parseMcpRegistryServer({ server: { name: 'a', remotes: [{ type: 'streamable-http', url: 'https://{tenant}.example.com/mcp' }] } })).toBeNull();
    expect(parseMcpRegistryServer({ server: { name: 'b', packages: [{ registryType: 'pypi', identifier: 'x', transport: { type: 'stdio' } }] } })).toBeNull();
    expect(parseMcpRegistryServer({ server: { name: 'c' } })).toBeNull();
    expect(parseMcpRegistryServer(null)).toBeNull();
  });
});

describe('searchMcpRegistry', () => {
  it('asks for latest versions, forwards search/cursor, and returns supported items plus the next cursor', async () => {
    let requested = '';
    const result = await searchMcpRegistry({
      search: ' github ', cursor: 'abc', limit: 10,
      fetchImpl: async (url) => {
        requested = String(url);
        return json({ servers: [{ server: { name: 'ok', remotes: [{ type: 'sse', url: 'https://e.com/sse' }] } }, { server: { name: 'skipped' } }], metadata: { nextCursor: 'next' } });
      },
    });
    expect(requested).toContain('version=latest');
    expect(requested).toContain('search=github');
    expect(requested).toContain('cursor=abc');
    expect(requested).toContain('limit=10');
    expect(result.items.map((i) => i.id)).toEqual(['ok']);
    expect(result.nextCursor).toBe('next');
  });
  it('reports a failing registry in plain words', async () => {
    await expect(searchMcpRegistry({ fetchImpl: async () => new Response('x', { status: 503 }) })).rejects.toThrow('HTTP 503');
  });
});

describe('mcpCatalogDraft', () => {
  it('names the server safely and lists required secrets first', () => {
    expect(suggestServerName('ai.smithery/Smithery-AI GitHub!!')).toBe('smithery-ai-github');
    const { entry, fields } = mcpCatalogDraft({ id: 'io.x/Srv', title: 't', description: '', install: { kind: 'npm', identifier: '@x/srv', version: '1.0.0', env: [{ name: 'OPTIONAL', required: false, secret: false }, { name: 'API_KEY', required: true, secret: true }] } });
    expect(entry).toMatchObject({ name: 'srv', transport: 'stdio', command: 'npx', args: ['-y', '@x/srv@1.0.0'], env: { API_KEY: '', OPTIONAL: '' } });
    expect(Object.keys(entry.env ?? {})[0]).toBe('API_KEY');
    expect(fields[0].name).toBe('API_KEY');
    const remote = mcpCatalogDraft({ id: 'a/b', title: 't', description: '', install: { kind: 'remote', transport: 'http', url: 'https://e.com/mcp', headers: [] } });
    expect(remote.entry).toMatchObject({ transport: 'http', url: 'https://e.com/mcp' });
    expect(remote.entry.headers).toBeUndefined();
  });
});

describe('resolvePluginSource', () => {
  it('maps every GitHub-hosted shape and refuses the rest', () => {
    expect(resolvePluginSource('./plugins/x')).toEqual({ owner: 'anthropics', repo: 'claude-plugins-official', ref: 'main', subdir: 'plugins/x' });
    expect(resolvePluginSource({ source: 'github', repo: 'o/r', ref: 'v1' })).toEqual({ owner: 'o', repo: 'r', ref: 'v1' });
    expect(resolvePluginSource({ source: 'url', url: 'https://github.com/o/r.git', sha: 'abc' })).toEqual({ owner: 'o', repo: 'r', ref: 'abc' });
    expect(resolvePluginSource({ source: 'git-subdir', url: 'https://github.com/o/r.git', path: 'plugins/a', ref: 'v2', sha: 'f00' })).toEqual({ owner: 'o', repo: 'r', ref: 'f00', subdir: 'plugins/a' });
    expect(resolvePluginSource({ source: 'url', url: 'https://gitlab.com/o/r.git' })).toBeNull();
    expect(resolvePluginSource({ source: 'git-subdir', url: 'https://github.com/o/r.git', path: '../escape' })).toBeNull();
    expect(resolvePluginSource('../outside')).toBeNull();
    expect(resolvePluginSource(42)).toBeNull();
  });
});

describe('parseMarketplace', () => {
  it('keeps supported plugins with their metadata', () => {
    const { name, entries } = parseMarketplace({ name: 'm', plugins: [
      { name: 'a', description: 'da', category: 'security', author: { name: 'Acme' }, homepage: 'https://a.dev', source: { source: 'github', repo: 'o/a' } },
      { name: 'gitlab-one', source: { source: 'url', url: 'https://gitlab.com/o/r.git' } },
      { description: 'no name', source: './x' },
    ] });
    expect(name).toBe('m');
    expect(entries.map((e) => e.item)).toEqual([{ id: 'a', name: 'a', description: 'da', category: 'security', author: 'Acme', homepage: 'https://a.dev', repo: 'o/a' }]);
  });
});

describe('download and install', () => {
  let dataRoot: string;
  beforeEach(async () => { resetCatalogCacheForTests(); dataRoot = await mkdtemp(path.join(os.tmpdir(), 'catalog-')); });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  /** What codeload returns: everything under a "<repo>-<ref>/" folder. */
  const repoZip = () => zipSync({
    'repo-abc/README.md': strToU8('# repo'),
    'repo-abc/plugins/helper/.claude-plugin/plugin.json': strToU8(JSON.stringify({ name: 'helper', version: '1.0.0' })),
    'repo-abc/plugins/helper/skills/fix/SKILL.md': strToU8('---\nname: Fix\n---\nbody'),
    'repo-abc/plugins/other/skills/nope/SKILL.md': strToU8('other plugin'),
  });
  const zipFetch = (calls: string[]) => async (url: string | URL | Request) => {
    calls.push(String(url));
    if (String(url).includes('codeload.github.com')) return new Response(repoZip() as unknown as BodyInit, { status: 200 });
    return json({ name: 'm', plugins: [{ name: 'helper', description: 'h', source: { source: 'git-subdir', url: 'https://github.com/o/repo.git', path: 'plugins/helper', sha: 'abc' } }] });
  };

  it('extracts only the plugin subfolder, stripping the repo prefix', async () => {
    const dest = await mkdtemp(path.join(dataRoot, 'dest-'));
    const count = await downloadGithubSource({ owner: 'o', repo: 'repo', ref: 'abc', subdir: 'plugins/helper' }, dest, async () => new Response(repoZip() as unknown as BodyInit, { status: 200 }));
    expect(count).toBe(2);
    expect(await readFile(path.join(dest, 'skills', 'fix', 'SKILL.md'), 'utf8')).toContain('body');
    await expect(readFile(path.join(dest, 'README.md'))).rejects.toThrow();
    await expect(readFile(path.join(dest, 'skills', 'nope', 'SKILL.md'))).rejects.toThrow();
  });

  it('refuses a download that fails or holds nothing for the plugin', async () => {
    const dest = await mkdtemp(path.join(dataRoot, 'dest-'));
    await expect(downloadGithubSource({ owner: 'o', repo: 'r', ref: 'x' }, dest, async () => new Response('', { status: 404 }))).rejects.toThrow('HTTP 404');
    await expect(downloadGithubSource({ owner: 'o', repo: 'r', ref: 'x', subdir: 'missing' }, dest, async () => new Response(repoZip() as unknown as BodyInit, { status: 200 }))).rejects.toThrow('没有找到');
  });

  it('installs a catalog plugin disabled, pinned to the catalog sha', async () => {
    const calls: string[] = [];
    const catalog = await fetchPluginCatalog(zipFetch(calls));
    expect(catalog.items.map((i) => i.id)).toEqual(['helper']);
    const installed = await installCatalogPlugin(dataRoot, 'helper', zipFetch(calls));
    expect(installed).toMatchObject({ id: 'helper', version: '1.0.0', enabled: false, skills: ['fix'] });
    expect(calls.some((c) => c.includes('/o/repo/zip/abc'))).toBe(true);
    expect((await listPlugins(dataRoot)).map((p) => p.id)).toEqual(['helper']);
    await expect(installCatalogPlugin(dataRoot, 'ghost', zipFetch(calls))).rejects.toThrow('没有插件 ghost');
  });
});
