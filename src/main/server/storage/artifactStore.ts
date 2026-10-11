import { validateHtmlContent } from '../../../shared/htmlContent';
import { normalizePresentation } from '../../../shared/presentationContent';
import { createHash } from 'node:crypto';
import { normalizeDocumentContent } from '../../../shared/documentContent';
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
import { stageArtifactBlob, readArtifactBlob } from './artifactBlobLease';
import { serializeFileMutation } from './atomicFile';

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

/** Manual saves closer together than this fold into one history entry. */
const MANUAL_EDIT_FOLD_MS = 5 * 60 * 1000;
/** Older plain manual saves beyond this many latest versions are dropped; labelled versions are kept. */
const MAX_RECENT_VERSIONS = 100;

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
  /** Internal SQLite-only callback, executed atomically with publishing the version. */
  onCommit?: (version: number) => void;
  expectedVersion?: number;
  content?: string;
  bytes?: Buffer;
  label?: string;
  origin: ArtifactOrigin;
  status?: ArtifactStatus;
  mimeType?: string;
}

export class ArtifactVersionConflictError extends Error {
  constructor() { super('内容已被更新，请重新读取后再保存；本次修改未覆盖现有内容'); }
}

export function createArtifactStore(handle: DbHandle, dataRoot: string) {
  const raw: DatabaseSync = handle.raw;
  const blobRoot = path.join(dataRoot, 'artifacts', 'blobs');

  // Native publication holds this ownership until its database transaction commits or is discarded.
  // Deleting an old version's directory cannot race a new publication using the same artifact id.
  const mutationPath = (id: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid artifact identity');
    return path.join(blobRoot, id);
  };
  function acquirePublication(id: string): Promise<() => void> {
    return new Promise((resolve, reject) => {
      void serializeFileMutation(mutationPath(id), () => new Promise<void>((release) => resolve(release))).catch(reject);
    });
  }

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
    if (kind === 'presentation') {
      if (input.bytes) throw new Error('可编辑 PPT 需要结构化页面内容');
      return { blob: false, text: JSON.stringify(normalizePresentation(JSON.parse(input.content ?? ''))) };
    }
    if (kind === 'doc') {
      if (input.bytes) throw new Error('可编辑文档必须使用结构化内容；DOCX 原文件请作为附件导入');
      return { blob: false, text: JSON.stringify(normalizeDocumentContent(JSON.parse(input.content ?? ''))) };
    }
    if (kind === 'html') { if (input.bytes) throw new Error('HTML requires text content'); return { blob: false, text: validateHtmlContent(input.content ?? '') }; }
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
    async preparePublish(input: CreateArtifactInput & { artifactId: string }, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const release = await acquirePublication(input.artifactId);
      let released = false;
      const releaseOnce = () => { if (!released) { released = true; release(); } };
      try {
        signal?.throwIfAborted();
        const previous = selById.get(input.artifactId) as unknown as ArtifactRowRaw | undefined;
        if (previous && previous.session_id !== input.sessionId) throw new Error('Artifact belongs to another session');
        if (previous && (previous.kind !== 'binary' || previous.mime_type !== input.mimeType || parseJson<ArtifactOrigin>(previous.origin_json, { surface: 'canvas' }).canvasNodeId !== input.origin?.canvasNodeId))
          throw new Error('Artifact belongs to another native output');
        if (!input.bytes || input.kind !== 'binary') throw new Error('Prepared publication requires a native binary artifact');
        const n = (previous?.current_version ?? 0) + 1;
        const staged = await stageArtifactBlob(dataRoot, input.artifactId, n, input.bytes, signal);
        const origin = input.origin ?? { surface: 'canvas' as const };
        return { ...staged, keep() { staged.keep(); releaseOnce(); }, async discard() { try { await staged.discard(); } finally { releaseOnce(); } }, commit(): ArtifactWithContent {
          const current = selById.get(input.artifactId) as unknown as ArtifactRowRaw | undefined;
          if ((current?.current_version ?? 0) !== n - 1 || current && current.session_id !== input.sessionId) throw new Error('Artifact version changed during export');
          const now = Date.now();
          if (!current) raw.prepare(`INSERT INTO artifacts (id, session_id, project_id, name, kind, renderer, status, mime_type, source, current_version, byte_size, origin_json, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'binary', 'raw', 'complete', ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.artifactId, input.sessionId, input.projectId ?? null, input.name, input.mimeType,
            input.source, n, staged.byteSize, JSON.stringify(origin), JSON.stringify(input.metadata ?? {}), now, now);
          else raw.prepare(`UPDATE artifacts SET name = ?, current_version = ?, byte_size = ?, status = 'complete', mime_type = ?, origin_json = ?, metadata_json = ?, updated_at = ? WHERE id = ?`)
            .run(input.name, n, staged.byteSize, input.mimeType, JSON.stringify(origin), JSON.stringify(input.metadata ?? {}), now, input.artifactId);
          insertVersionRow(input.artifactId, n, 'Local export', origin, { storage: 'blob', content: null, blobPath: staged.blobPath, byteSize: staged.byteSize, digest: staged.digest });
          return { ...toMeta(selById.get(input.artifactId) as unknown as ArtifactRowRaw), content: '', rawUrl: `/api/artifacts/${input.artifactId}/raw?v=${n}` };
        } };
      } catch (error) { releaseOnce(); throw error; }
    },
    async readBlob(id: string, version: number): Promise<Buffer> {
      const row = selVersion.get(id, version) as unknown as VersionRowRaw | undefined;
      if (!row || row.storage !== 'blob' || !row.blob_path) throw new Error('Artifact blob version not found');
      return readArtifactBlob(dataRoot, row.blob_path);
    },
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
      return serializeFileMutation(mutationPath(id), async () => {
      const row = selById.get(id) as unknown as ArtifactRowRaw | undefined;
      if (!row) return null;
      if (input.expectedVersion !== undefined && row.current_version !== input.expectedVersion) throw new ArtifactVersionConflictError();
      const kind = row.kind as ArtifactKind;
      if ((kind === 'doc' || kind === 'html' || kind === 'presentation') && input.origin.surface !== 'manual_edit') throw new Error('文档的 AI 修改必须先保存为待审核草稿');
      const n = row.current_version + 1;
      const label =
        input.label ??
        (input.origin.surface === 'manual_edit' ? 'Manual edit' : 'AI edit');
      const m = materialise(
        { content: input.content, bytes: input.bytes, mimeType: input.mimeType || row.mime_type },
        kind,
      );
      const prepared = await prepareVersion(id, n, row.name, kind, m);
      // Autosave appends a full-content row every few seconds of typing. Plain manual saves are
      // therefore (1) skipped when nothing changed and (2) folded into the previous manual save
      // when it is recent, so history keeps meaningful steps instead of every pause.
      const plainManual = input.origin.surface === 'manual_edit' && (input.label === undefined || input.label === 'Manual edit') && prepared.storage === 'inline';
      let foldPrevious = false;
      if (plainManual) {
        const head = selVersion.get(id, row.current_version) as unknown as VersionRowRaw | undefined;
        if (head?.storage === 'inline' && head.content_digest === prepared.digest) return store.get(id);
        foldPrevious =
          head?.storage === 'inline' &&
          head.label === 'Manual edit' &&
          parseJson<ArtifactOrigin>(head.origin_json, { surface: 'chat' }).surface === 'manual_edit' &&
          Date.now() - head.created_at < MANUAL_EDIT_FOLD_MS;
      }
      tx(() => {
        const latest = selById.get(id) as unknown as ArtifactRowRaw | undefined;
        if (!latest || latest.current_version !== row.current_version) throw new ArtifactVersionConflictError();
        // The folded row's number is retired, not reused: a review based on it must read as stale.
        if (foldPrevious) raw.prepare('DELETE FROM artifact_versions WHERE artifact_id = ? AND n = ?').run(id, row.current_version);
        insertVersionRow(id, n, label, input.origin, prepared);
        if (plainManual) {
          raw
            .prepare(
              `DELETE FROM artifact_versions
               WHERE artifact_id = ? AND storage = 'inline' AND label = 'Manual edit' AND n > 1
                 AND n NOT IN (SELECT n FROM artifact_versions WHERE artifact_id = ? ORDER BY n DESC LIMIT ?)`,
            )
            .run(id, id, MAX_RECENT_VERSIONS);
        }
        raw
          .prepare(
            `UPDATE artifacts SET current_version = ?, byte_size = ?, status = ?, origin_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(n, prepared.byteSize, input.status ?? 'complete', JSON.stringify(input.origin), Date.now(), id);
        input.onCommit?.(n);
      });
      return store.get(id);
      });
    },

    async restoreVersion(id: string, n: number, expectedVersion?: number): Promise<ArtifactWithContent | null> {
      const row = selById.get(id) as unknown as ArtifactRowRaw | undefined;
      if (!row) return null;
      const src = selVersion.get(id, n) as unknown as VersionRowRaw | undefined;
      if (!src) return null;
      const origin: ArtifactOrigin = { ...parseJson<ArtifactOrigin>(src.origin_json, { surface: 'chat' }) };
      if (row.kind === 'doc' || row.kind === 'html' || row.kind === 'presentation') origin.surface = 'manual_edit';
      if (src.storage === 'blob' && src.blob_path) {
        const bytes = await readFile(path.join(blobRoot, src.blob_path));
        return store.addVersion(id, { bytes, origin, expectedVersion: expectedVersion ?? row.current_version, label: `Restored from v${n}` });
      }
      return store.addVersion(id, {
        content: src.content ?? '',
        expectedVersion: expectedVersion ?? row.current_version,
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
        // A workspace file rewrite cannot publish over a managed, review-protected document.
        if ((existing.kind === 'doc' || existing.kind === 'html' || existing.kind === 'presentation' || existing.kind === 'sheet') && input.origin.surface !== 'manual_edit') return store.create(input);
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
      await serializeFileMutation(mutationPath(id), async () => {
        raw.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
        await rm(mutationPath(id), { recursive: true, force: true });
      });
    },

    async removeBySession(sessionId: string): Promise<void> {
      const ids = (
        raw.prepare('SELECT id FROM artifacts WHERE session_id = ?').all(sessionId) as {
          id: string;
        }[]
      ).map((r) => r.id);
      await Promise.all(ids.map((id) => store.remove(id)));
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
