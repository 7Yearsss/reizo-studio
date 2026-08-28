import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

/**
 * Spills oversized strings (huge tool outputs) to disk so they never ride
 * the stream or bloat the message DB. The caller keeps a `{ __ref }` marker
 * with an 8 KB preview; the full value is fetched on demand via
 * `GET /api/refs/:id`.
 *
 * Spill failure THROWS — a silent inline fallback would defeat the whole
 * guard.
 */

export const SPILL_THRESHOLD_BYTES = 256 * 1024;
const PREVIEW_BYTES = 8 * 1024;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export interface SpilledRef {
  __ref: string;
  sizeBytes: number;
  preview: string;
}

interface RefMeta {
  sizeBytes: number;
  preview: string;
  createdAt: number;
  ttlMs: number;
}

export interface LargeValueStore {
  /** Returns a ref marker if spilled, or `null` if the value fits inline. */
  maybeSpill(value: string): SpilledRef | null;
  /** `{ status: 'ok' | 'missing' | 'expired', content?: string }` */
  read(id: string): { status: 'ok'; content: string } | { status: 'missing' | 'expired' };
}

export function createLargeValueStore(dataRoot: string): LargeValueStore {
  const dir = path.join(dataRoot, 'refs');

  function ensureDir(): void {
    mkdirSync(dir, { recursive: true });
  }

  function metaPath(id: string): string {
    return path.join(dir, `${id}.meta.json`);
  }
  function bodyPath(id: string): string {
    return path.join(dir, id);
  }

  return {
    maybeSpill(value: string): SpilledRef | null {
      const sizeBytes = Buffer.byteLength(value, 'utf8');
      if (sizeBytes <= SPILL_THRESHOLD_BYTES) return null;

      ensureDir();
      const id = nanoid();
      const preview = value.length > PREVIEW_BYTES ? `${value.slice(0, PREVIEW_BYTES)}\n…[truncated]` : value;
      const meta: RefMeta = { sizeBytes, preview, createdAt: Date.now(), ttlMs: DEFAULT_TTL_MS };

      // Exclusive .part write + atomic rename so a concurrent reader never
      // sees a half-written body.
      const part = `${bodyPath(id)}.part`;
      try {
        writeFileSync(part, value, { encoding: 'utf8', flag: 'wx' });
        renameSync(part, bodyPath(id));
        writeFileSync(metaPath(id), JSON.stringify(meta), 'utf8');
      } catch (err) {
        try {
          rmSync(part, { force: true });
        } catch {
          /* ignore */
        }
        throw new Error(
          `largeValueStore: failed to spill ${sizeBytes} bytes: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { __ref: id, sizeBytes, preview };
    },

    read(id: string) {
      let meta: RefMeta;
      try {
        meta = JSON.parse(readFileSync(metaPath(id), 'utf8')) as RefMeta;
      } catch {
        return { status: 'missing' as const };
      }
      if (Date.now() - meta.createdAt > meta.ttlMs) {
        try {
          rmSync(bodyPath(id), { force: true });
          rmSync(metaPath(id), { force: true });
        } catch {
          /* ignore */
        }
        return { status: 'expired' as const };
      }
      try {
        const content = readFileSync(bodyPath(id), 'utf8');
        void statSync(bodyPath(id));
        return { status: 'ok' as const, content };
      } catch {
        return { status: 'missing' as const };
      }
    },
  };
}
