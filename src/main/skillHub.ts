import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type {
  SkillHubEntry,
  SkillHubInstallRequest,
  SkillHubInstallResult,
  SkillHubSearchQuery,
  SkillHubSearchResult,
} from '../shared/skillhub';

const API_BASE = 'https://api.skillhub.cn';
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_PACKAGE_FILES = 256;
const FETCH_TIMEOUT_MS = 15_000;

/** Marker written next to SKILL.md so we can tell which hub entry a dir came from. */
const MARKER_FILE = '.skillhub.json';

interface RawEntry {
  slug?: string;
  name?: string;
  displayName?: string;
  description?: string;
  description_zh?: string;
  downloads?: number;
  installs?: number;
  stars?: number;
  score?: number;
  version?: string;
  source?: string;
  iconUrl?: string;
  verified?: boolean;
  category?: string;
  namespace?: { handle?: string; canonicalName?: string };
}

function toEntry(raw: RawEntry): SkillHubEntry | null {
  const slug = raw.slug?.trim();
  if (!slug) return null;
  const namespace = raw.namespace?.handle ?? '';
  return {
    slug,
    namespace,
    canonicalName: raw.namespace?.canonicalName ?? (namespace ? `@${namespace}/${slug}` : slug),
    name: raw.displayName || raw.name || slug,
    description: raw.description_zh || raw.description || '',
    downloads: raw.downloads ?? 0,
    installs: raw.installs ?? 0,
    stars: raw.stars ?? 0,
    score: raw.score ?? 0,
    version: raw.version ?? '',
    source: raw.source ?? 'community',
    iconUrl: raw.iconUrl || undefined,
    verified: raw.verified === true,
    category: raw.category,
  };
}

async function hubFetch(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`SkillHub 请求失败 (${res.status})`);
  return res;
}

export async function searchSkillHub(query: SkillHubSearchQuery = {}): Promise<SkillHubSearchResult> {
  const params = new URLSearchParams();
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 24));
  if (query.keyword?.trim()) params.set('keyword', query.keyword.trim());
  if (query.category) params.set('category', query.category);
  if (query.source && query.source !== 'all') params.set('source', query.source);
  params.set('sortBy', query.sortBy ?? 'downloads');
  params.set('order', query.order ?? 'desc');

  const res = await hubFetch(`${API_BASE}/api/skills?${params.toString()}`);
  const json = (await res.json()) as { code?: number; data?: { skills?: RawEntry[]; total?: number } };
  const items = (json.data?.skills ?? [])
    .map(toEntry)
    .filter((entry): entry is SkillHubEntry => entry !== null);
  return { items, total: json.data?.total ?? items.length };
}

function sanitizeDirName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'skill';
}

/** Safe relative path inside a zip, or null when the entry must be skipped. */
export function safeZipPath(entryPath: string): string | null {
  const normalized = path.posix.normalize(entryPath.replace(/\\/g, '/'));
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('/') ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.endsWith('/')
  ) {
    return null;
  }
  return normalized;
}

async function readMarkerCanonical(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, MARKER_FILE), 'utf8');
    const parsed = JSON.parse(raw) as { canonicalName?: string };
    return typeof parsed.canonicalName === 'string' ? parsed.canonicalName : null;
  } catch {
    return null;
  }
}

/** Pick a free install dir for `slug`, reusing it when it already holds the same hub entry. */
async function pickInstallDir(userSkillsDir: string, slug: string, namespace: string, canonicalName: string): Promise<{ id: string; dir: string }> {
  const base = sanitizeDirName(slug);
  const handle = sanitizeDirName(namespace.replace(/^clawhub_/, ''));
  const candidates = [base, `${base}--${handle || 'hub'}`];
  for (let i = 2; i <= 9; i++) candidates.push(`${base}--${handle || 'hub'}-${i}`);
  for (const id of candidates) {
    const dir = path.join(userSkillsDir, id);
    const existingCanonical = await readMarkerCanonical(dir);
    if (existingCanonical === null) {
      // No marker: dir is either absent or a manually-installed skill — don't clobber it.
      try {
        await readFile(path.join(dir, 'SKILL.md'), 'utf8');
        continue; // occupied by a non-hub skill
      } catch {
        return { id, dir }; // free
      }
    }
    if (existingCanonical === canonicalName) return { id, dir }; // same entry → update in place
  }
  throw new Error(`无法为 ${slug} 分配安装目录`);
}

export async function installSkillHubPackage(
  userSkillsDir: string,
  request: SkillHubInstallRequest,
): Promise<SkillHubInstallResult> {
  const params = new URLSearchParams({ slug: request.slug });
  if (request.namespace) params.set('namespace', request.namespace);
  if (request.version) params.set('version', request.version);

  const res = await hubFetch(`${API_BASE}/api/v1/download?${params.toString()}`);
  const zipBytes = new Uint8Array(await res.arrayBuffer());
  if (zipBytes.byteLength > MAX_PACKAGE_BYTES) throw new Error('技能包过大');

  const files = unzipSync(zipBytes);
  const entries: { rel: string; data: Uint8Array }[] = [];
  let total = 0;
  for (const [name, data] of Object.entries(files)) {
    const rel = safeZipPath(name);
    if (!rel) continue;
    total += data.byteLength;
    if (total > MAX_PACKAGE_BYTES) throw new Error('技能包过大');
    entries.push({ rel, data });
  }
  if (entries.length === 0 || entries.length > MAX_PACKAGE_FILES) throw new Error('技能包内容异常');
  const hasMarkdown = entries.some((e) => e.rel.toLowerCase().endsWith('.md'));
  if (!hasMarkdown) throw new Error('技能包中未找到 SKILL.md');

  // Prefer the canonical name from the entry over nothing; fall back to slug.
  const canonicalName = request.namespace ? `@${request.namespace}/${request.slug}` : request.slug;
  const { id, dir } = await pickInstallDir(userSkillsDir, request.slug, request.namespace, canonicalName);

  // Wipe a previous install of the same entry, then write the fresh tree.
  await rm(dir, { recursive: true, force: true });
  for (const { rel, data } of entries) {
    const target = path.join(dir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  await writeFile(
    path.join(dir, MARKER_FILE),
    JSON.stringify(
      { canonicalName, slug: request.slug, namespace: request.namespace, version: request.version ?? null, installedAt: Date.now() },
      null,
      2,
    ),
  );
  return { id };
}
