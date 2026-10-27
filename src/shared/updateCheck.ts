/**
 * Update check result in four honest states. "latest" is only ever said when a feed was actually read and carries
 * a version that is not newer; no feed (a dev build, an unofficial package) is "disabled", never "up to date".
 */
export interface UpdateFeed { version: string; notes?: string; url: string }

export type UpdateStatus =
  | { status: 'available'; current: string; latest: string; notes?: string; url: string }
  | { status: 'latest'; current: string; latest: string }
  | { status: 'disabled'; current: string; reason: string }
  | { status: 'error'; current: string; reason: string };

function parse(version: string): { nums: number[]; pre: boolean } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/.exec(version.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: Boolean(m[4]) } : null;
}

/** >0 when `a` is newer than `b`; null when either is not a version. A pre-release is older than its release. */
export function compareVersions(a: string, b: string): number | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  return x.pre === y.pre ? 0 : x.pre ? -1 : 1;
}

/** Only https links from the feed are ever offered to open. */
export function parseUpdateFeed(raw: unknown): UpdateFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.version !== 'string' || !parse(v.version) || typeof v.url !== 'string') return null;
  try { if (new URL(v.url).protocol !== 'https:') return null; } catch { return null; }
  return { version: v.version.trim(), url: v.url, ...(typeof v.notes === 'string' && v.notes.trim() ? { notes: v.notes.trim().slice(0, 2000) } : {}) };
}

export function judgeUpdate(current: string, feed: UpdateFeed | null | undefined, feedConfigured: boolean, error?: string): UpdateStatus {
  if (!feedConfigured) return { status: 'disabled', current, reason: '这个版本没有配置更新源（开发包或非官方包），不会检查更新' };
  if (error || !feed) return { status: 'error', current, reason: error ?? '更新源返回的内容无法识别' };
  const diff = compareVersions(feed.version, current);
  if (diff === null) return { status: 'error', current, reason: '无法比较版本号' };
  if (diff > 0) return { status: 'available', current, latest: feed.version, url: feed.url, ...(feed.notes ? { notes: feed.notes } : {}) };
  return { status: 'latest', current, latest: feed.version };
}
