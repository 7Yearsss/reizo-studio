import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import {
  extForBlob,
  inferArtifactKind,
  inferRenderer,
  isBlobKind,
  mimeForKind,
  type Artifact,
  type ArtifactKind,
  type ArtifactOrigin,
  type ArtifactRenderer,
  type ArtifactSource,
  type ArtifactStatus,
  type ArtifactVersion,
  type ArtifactWithContent,
} from '../../../shared/artifact';
import type { DbHandle } from '../db/client';

/** Inline text content over this many bytes is refused — use a blob kind. */
const MAX_INLINE_BYTES = 4_000_000;

interface ArtifactRowRaw {
  id: string;
  session_id: string;
  project_id: string | null;
  name: string;
  kind: string;
  renderer: string;
  status: string;
  mime_type: string;
  source: string;
  current_version: number;
  byte_size: number;
  origin_json: string | null;
  metadata_json: string | null;
  created_at: number;
  updated_at: number;
}

interface VersionRowRaw {
  rowid: number;
  artifact_id: string;
  n: number;
  label: string;
  origin_json: string;
  byte_size: number;
  content_digest: string;
  storage: string;
  content: string | null;
  blob_path: string | null;
  created_at: number;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A `data:` URL → raw bytes, or `null` if it isn't one. */
function decodeDataUrl(value: string): { bytes: Buffer; mime: string } | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { bytes, mime };
}

export interface CreateArtifactInput {
  sessionId: string;
  projectId?: string | null;
  name: string;
  /** Text content, or a `data:` URL for a blob. Ignored if `bytes` is set. */
  content?: string;
  /** Raw binary for a blob artifact. */
  bytes?: Buffer;
  source: ArtifactSource;
  kind?: ArtifactKind;
  renderer?: ArtifactRenderer;
  status?: ArtifactStatus;
  mimeType?: string;
  origin?: ArtifactOrigin;
  metadata?: Record<string, unknown>;
}

export interface AddVersionInput {
  content?: string;
  bytes?: Buffer;
  label?: string;
  origin: ArtifactOrigin;
  status?: ArtifactStatus;
  mimeType?: string;
}

export function createArtifactStore(handle: DbHandle, dataRoot: string) {
  const raw: DatabaseSync = handle.raw;
  const blobRoot = path.join(dataRoot, 'artifacts', 'blobs');

  const selById = raw.prepare('SELECT * FROM artifacts WHERE id = ?');
  const selBySession = raw.prepare(
    'SELECT * FROM artifacts WHERE session_id = ? ORDER BY updated_at DESC',
  );
  const selAll = raw.prepare('SELECT * FROM artifacts ORDER BY updated_at DESC');
  const selVersion = raw.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? AND n = ?');
  const selVersions = raw.prepare(
    'SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY n',
  );
  const selLatestByName = raw.prepare(
    'SELECT * FROM artifacts WHERE session_id = ? AND name = ? ORDER BY updated_at DESC LIMIT 1',
  );

  function tx<T>(fn: () => T): T {
    raw.exec('BEGIN');
    try {
      const out = fn();
      raw.exec('COMMIT');
      return out;
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  }

  function toMeta(row: ArtifactRowRaw): Artifact {
    const versionCount =
      (
        raw
          .prepare('SELECT COUNT(*) AS c FROM artifact_versions WHERE artifact_id = ?')
          .get(row.id) as { c: number }
      ).c ?? row.current_version;
    return {
      id: row.id,
      sessionId: row.session_id,
      projectId: row.project_id,
      name: row.name,
      kind: row.kind as ArtifactKind,
      renderer: row.renderer as ArtifactRenderer,
      status: row.status as ArtifactStatus,
      mimeType: row.mime_type,
      source: row.source as ArtifactSource,
      version: row.current_version,
      versionCount,
      byteSize: row.byte_size,
      origin: row.origin_json ? parseJson<ArtifactOrigin>(row.origin_json, undefined as never) : undefined,
      metadata: row.metadata_json
        ? parseJson<Record<string, unknown>>(row.metadata_json, {})
        : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  function toVersion(row: VersionRowRaw): ArtifactVersion {
    return {
      n: row.n,
      label: row.label,
      origin: parseJson<ArtifactOrigin>(row.origin_json, { surface: 'chat' }),
      byteSize: row.byte_size,
      contentDigest: row.content_digest,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /** Resolve `{ bytes | text }` from a create/add input, honouring `data:` URLs. */
  function materialise(
    input: { content?: string; bytes?: Buffer; mimeType?: string },
    kind: ArtifactKind,
  ): { blob: boolean; bytes?: Buffer; text?: string; mime?: string } {
    if (input.bytes) return { blob: true, bytes: input.bytes, mime: input.mimeType };
    const value = input.content ?? '';
    const decoded = value.startsWith('data:') ? decodeDataUrl(value) : null;
    if (decoded) return { blob: true, bytes: decoded.bytes, mime: input.mimeType || decoded.mime };
    if (isBlobKind(kind) && value.startsWith('http')) {
      // A bare URL for a blob kind: keep it inline as a pointer.
      return { blob: false, text: value };
    }
    return { blob: isBlobKind(kind) && value.length === 0 ? true : false, text: value };
  }

  async function writeBlob(artifactId: string, n: number, name: string, mime: string, bytes: Buffer) {
    const ext = extForBlob(name, mime);
    const dir = path.join(blobRoot, artifactId);
    await mkdir(dir, { recursive: true });
    const rel = path.posix.join(artifactId, `v${n}${ext}`);
    await writeFile(path.join(blobRoot, rel), bytes);
    return rel;
  }

  async function readVersionContent(
    row: VersionRowRaw,
  ): Promise<{ content: string; rawUrl?: string }> {
    if (row.storage === 'inline') return { content: row.content ?? '' };
    return {
      content: '',
      rawUrl: `/api/artifacts/${row.artifact_id}/raw?v=${row.n}`,
    };
  }

  /** Do the async fs work (blob write) up front so the row inserts stay sync. */
  async function prepareVersion(
    artifactId: string,
    n: number,
    name: string,
    kind: ArtifactKind,
    m: { blob: boolean; bytes?: Buffer; text?: string; mime?: string },
  ): Promise<{
    storage: 'inline' | 'blob';
    content: string | null;
    blobPath: string | null;
    byteSize: number;
    digest: string;
  }> {
    if (m.blob && m.bytes) {
      const blobPath = await writeBlob(artifactId, n, name, m.mime || mimeForKind(kind), m.bytes);
      return {
        storage: 'blob',
        content: null,
        blobPath,
        byteSize: m.bytes.byteLength,
        digest: sha256(m.bytes),
      };
    }
    const text = m.text ?? '';
    const byteSize = Buffer.byteLength(text, 'utf8');
    if (byteSize > MAX_INLINE_BYTES) {
      throw new Error(`Artifact text too large (${byteSize} bytes); use a blob kind`);
    }
    return { storage: 'inline', content: text, blobPath: null, byteSize, digest: sha256(text) };
  }

  function insertVersionRow(
    artifactId: string,
    n: number,
    label: string,
    origin: ArtifactOrigin,
    prepared: Awaited<ReturnType<typeof prepareVersion>>,
  ): void {
    raw
      .prepare(
        `INSERT INTO artifact_versions
         (artifact_id, n, label, origin_json, byte_size, content_digest, storage, content, blob_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifactId,
        n,
        label,
        JSON.stringify(origin),
        prepared.byteSize,
        prepared.digest,
        prepared.storage,
        prepared.content,
        prepared.blobPath,
        Date.now(),
      );
  }

  const store = {
    async listAll(): Promise<Artifact[]> {
      return (selAll.all() as unknown as ArtifactRowRaw[]).map(toMeta);
    },

    async listBySession(sessionId: string): Promise<Artifact[]> {
      return (selBySession.all(sessionId) as unknown as ArtifactRowRaw[]).map(toMeta);
    },

    getMeta(id: string): Artifact | null {
      const row = selById.get(id) as unknown as ArtifactRowRaw | undefined;
      return row ? toMeta(row) : null;
    },

    async get(id: string, version?: number): Promise<ArtifactWithContent | null> {
      const row = selById.get(id) as unknown as ArtifactRowRaw | undefined;
      if (!row) return null;
      const n = version ?? row.current_version;
      const vrow = selVersion.get(id, n) as unknown as VersionRowRaw | undefined;
      const meta = toMeta(row);
      if (!vrow) return { ...meta, content: '' };
      const resolved = await readVersionContent(vrow);
      return { ...meta, version: n, ...resolved };
    },

    /** Absolute filesystem path of a blob version, for the raw route. */
    blobFilePath(id: string, version: number): string | null {
      const vrow = selVersion.get(id, version) as unknown as VersionRowRaw | undefined;
      if (!vrow || vrow.storage !== 'blob' || !vrow.blob_path) return null;
      return path.join(blobRoot, vrow.blob_path);
    },

    listVersions(id: string): ArtifactVersion[] {
      return (selVersions.all(id) as unknown as VersionRowRaw[]).map(toVersion);
    },

    async create(input: CreateArtifactInput): Promise<ArtifactWithContent> {
      const kind = input.kind ?? inferArtifactKind(input.name, input.mimeType);
      const renderer = input.renderer ?? inferRenderer(kind);
      const mimeType = input.mimeType || mimeForKind(kind);
      const origin: ArtifactOrigin = input.origin ?? {
        surface: input.source === 'attachment' ? 'attachment' : 'chat',
      };
      const label =
        input.source === 'attachment'
          ? 'Attachment'
          : input.source === 'manual'
            ? 'Manual edit'
            : 'AI edit';
      const m = materialise(input, kind);
      const id = nanoid();
      const now = Date.now();
      const prepared = await prepareVersion(id, 1, input.name, kind, m);

      tx(() => {
        raw
          .prepare(
            `INSERT INTO artifacts
             (id, session_id, project_id, name, kind, renderer, status, mime_type, source,
              current_version, byte_size, origin_json, metadata_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.sessionId,
            input.projectId ?? null,
            input.name,
            kind,
            renderer,
            input.status ?? 'complete',
            mimeType,
            input.source,
            prepared.byteSize,
            JSON.stringify(origin),
            input.metadata ? JSON.stringify(input.metadata) : null,
            now,
            now,
          );
        insertVersionRow(id, 1, label, origin, prepared);
      });

      const full = await store.get(id);
      if (!full) throw new Error('artifact missing after create');
      return full;
    },

    async addVersion(id: string, input: AddVersionInput): Promise<ArtifactWithContent | null> {
      const row = selById.get(id) as unknown as ArtifactRowRaw | undefined;
      if (!row) return null;
      const kind = row.kind as ArtifactKind;
      const n = row.current_version + 1;
      const label =
        input.label ??
        (input.origin.surface === 'manual_edit' ? 'Manual edit' : 'AI edit');
      const m = materialise(
        { content: input.content, bytes: input.bytes, mimeType: input.mimeType || row.mime_type },
        kind,
      );
      const prepared = await prepareVersion(id, n, row.name, kind, m);
      tx(() => {
        insertVersionRow(id, n, label, input.origin, prepared);
        raw
          .prepare(
            `UPDATE artifacts SET current_version = ?, byte_size = ?, status = ?, origin_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(n, prepared.byteSize, input.status ?? 'complete', JSON.stringify(input.origin), Date.now(), id);
      });
      return store.get(id);
    },

    async restoreVersion(id: string, n: number): Promise<ArtifactWithContent | null> {
      const row = selById.get(id) as unknown as ArtifactRowRaw | undefined;
      if (!row) return null;
      const src = selVersion.get(id, n) as unknown as VersionRowRaw | undefined;
      if (!src) return null;
      const origin: ArtifactOrigin = { ...parseJson<ArtifactOrigin>(src.origin_json, { surface: 'chat' }) };
      if (src.storage === 'blob' && src.blob_path) {
        const bytes = await readFile(path.join(blobRoot, src.blob_path));
        return store.addVersion(id, { bytes, origin, label: `Restored from v${n}` });
      }
      return store.addVersion(id, {
        content: src.content ?? '',
        origin,
        label: `Restored from v${n}`,
      });
    },

    /**
     * Producer helper: if this session already has an artifact with `name`,
     * append a version; otherwise create it. Used by the file-write hook so a
     * turn that rewrites `plan.md` builds a history instead of a pile of rows.
     */
    async createOrAddVersion(
      input: CreateArtifactInput & { origin: ArtifactOrigin },
    ): Promise<ArtifactWithContent> {
      const existing = selLatestByName.get(input.sessionId, input.name) as unknown as
        | ArtifactRowRaw
        | undefined;
      if (existing) {
        const updated = await store.addVersion(existing.id, {
          content: input.content,
          bytes: input.bytes,
          origin: input.origin,
          status: input.status,
          mimeType: input.mimeType,
        });
        if (updated) return updated;
      }
      return store.create(input);
    },

    async setStatus(id: string, status: ArtifactStatus): Promise<void> {
      raw
        .prepare('UPDATE artifacts SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, Date.now(), id);
    },

    async remove(id: string): Promise<void> {
      raw.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
      await rm(path.join(blobRoot, id), { recursive: true, force: true });
    },

    async removeBySession(sessionId: string): Promise<void> {
      const ids = (
        raw.prepare('SELECT id FROM artifacts WHERE session_id = ?').all(sessionId) as {
          id: string;
        }[]
      ).map((r) => r.id);
      raw.prepare('DELETE FROM artifacts WHERE session_id = ?').run(sessionId);
      await Promise.all(
        ids.map((id) => rm(path.join(blobRoot, id), { recursive: true, force: true })),
      );
    },
  };

  // One-shot migration of the legacy JSON-file store.
  importLegacyJsonArtifacts(raw, dataRoot);

  return store;
}

export type ArtifactStore = ReturnType<typeof createArtifactStore>;

/**
 * Legacy import: `<dataRoot>/artifacts/*.json` written by the old store are
 * read into the tables once, then the directory is renamed to
 * `artifacts.legacy/` so a second launch is a no-op. Idempotent: guarded by
 * the presence of the source dir + a marker.
 */
function importLegacyJsonArtifacts(raw: DatabaseSync, dataRoot: string): void {
  const dir = path.join(dataRoot, 'artifacts');
  const marker = path.join(dataRoot, 'artifacts.legacy-imported');
  if (existsSync(marker)) return;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return; // no legacy dir
  }
  if (files.length === 0) {
    try {
      writeFileSync(marker, new Date().toISOString(), 'utf8');
    } catch {
      /* ignore */
    }
    return;
  }
  let imported = 0;
  for (const file of files) {
    try {
      const legacy = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as {
        id: string;
        sessionId: string;
        projectId?: string | null;
        name: string;
        kind: string;
        mimeType: string;
        source: string;
        createdAt: string;
        content: string;
      };
      const sessionExists = raw
        .prepare('SELECT 1 FROM sessions WHERE id = ?')
        .get(legacy.sessionId);
      if (!sessionExists) continue;
      const kind = (legacy.kind as ArtifactKind) || inferArtifactKind(legacy.name, legacy.mimeType);
      const renderer = inferRenderer(kind);
      const ts = Date.parse(legacy.createdAt) || Date.now();
      const origin = JSON.stringify({ surface: legacy.source === 'attachment' ? 'attachment' : 'chat' });
      const digest = createHash('sha256').update(legacy.content ?? '').digest('hex');
      const byteSize = Buffer.byteLength(legacy.content ?? '', 'utf8');
      raw.exec('BEGIN');
      try {
        raw
          .prepare(
            `INSERT OR IGNORE INTO artifacts
             (id, session_id, project_id, name, kind, renderer, status, mime_type, source,
              current_version, byte_size, origin_json, metadata_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'complete', ?, ?, 1, ?, ?, NULL, ?, ?)`,
          )
          .run(
            legacy.id,
            legacy.sessionId,
            legacy.projectId ?? null,
            legacy.name,
            kind,
            renderer,
            legacy.mimeType || mimeForKind(kind),
            legacy.source === 'attachment' ? 'attachment' : 'generated',
            byteSize,
            origin,
            ts,
            ts,
          );
        raw
          .prepare(
            `INSERT OR IGNORE INTO artifact_versions
             (artifact_id, n, label, origin_json, byte_size, content_digest, storage, content, blob_path, created_at)
             VALUES (?, 1, 'Imported', ?, ?, ?, 'inline', ?, NULL, ?)`,
          )
          .run(legacy.id, origin, byteSize, digest, legacy.content ?? '', ts);
        raw.exec('COMMIT');
        imported += 1;
      } catch {
        raw.exec('ROLLBACK');
      }
    } catch {
      /* skip unreadable file */
    }
  }
  try {
    renameSync(dir, path.join(dataRoot, `artifacts.legacy-${Date.now()}`));
  } catch {
    /* dir may be locked on Windows; the marker still prevents re-import */
  }
  try {
    writeFileSync(marker, new Date().toISOString(), 'utf8');
  } catch {
    /* ignore */
  }
  if (imported > 0) console.info(`[artifacts] imported ${imported} legacy JSON artifact(s)`);
}
