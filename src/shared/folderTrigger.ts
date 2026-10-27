/**
 * Pure parts of "run this when something lands in a folder": which files count, and how a burst of file events
 * collapses into one run. Dropping 100 files into a watched folder must start a handful of runs at most, each told
 * about every file it covers — never 100 runs.
 */

/** Editors, browsers and sync tools leave half-written or scratch files around; a run should wait for the real one. */
const PARTIAL = /(^|[\\/])(\.|~\$)|\.(tmp|temp|part|crdownload|download|swp|swx|lock)$|~$/i;

export function isPartialFile(relativePath: string): boolean {
  return PARTIAL.test(relativePath);
}

/** `*` within a folder, `**` across folders, `?` one character; matched against the whole relative path, ignoring case. */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  const p = pattern.replace(/\\/g, '/');
  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') { out += '.*'; i += 1; if (p[i + 1] === '/') i += 1; }
      else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

export function matchesPattern(relativePath: string, pattern: string | undefined): boolean {
  if (!pattern || pattern.trim() === '' || pattern.trim() === '*') return true;
  const path = relativePath.replace(/\\/g, '/');
  // A pattern without a slash means "any file with this name or extension, in any subfolder".
  const effective = pattern.includes('/') || pattern.includes('\\') ? pattern : `**/${pattern}`;
  return globToRegExp(effective).test(path);
}

export interface BatcherOptions {
  /** Quiet time after the last event before a run starts. */
  debounceMs: number;
  /** A steady stream of events still starts a run after this long. */
  maxWaitMs: number;
  /** Most paths reported per run; the rest are counted. */
  maxPaths?: number;
  onFire: (batch: { paths: string[]; omitted: number }) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

export function createEventBatcher(options: BatcherOptions) {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = options.now ?? Date.now;
  const maxPaths = options.maxPaths ?? 200;
  const pending = new Set<string>();
  let timer: unknown = null;
  let firstAt = 0;

  function fire(): void {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (pending.size === 0) return;
    const all = [...pending];
    pending.clear();
    firstAt = 0;
    options.onFire({ paths: all.slice(0, maxPaths), omitted: Math.max(0, all.length - maxPaths) });
  }

  return {
    add(relativePath: string): void {
      pending.add(relativePath);
      if (firstAt === 0) firstAt = now();
      if (timer !== null) clearTimer(timer);
      const waited = now() - firstAt;
      timer = setTimer(fire, Math.max(0, Math.min(options.debounceMs, options.maxWaitMs - waited)));
    },
    flush: fire,
    cancel(): void {
      if (timer !== null) { clearTimer(timer); timer = null; }
      pending.clear();
      firstAt = 0;
    },
  };
}
