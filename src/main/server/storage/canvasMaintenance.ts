import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { DbHandle } from '../db/client';
import type { CanvasMaintenanceFile, CanvasMaintenanceScan, CanvasQuarantineBatch } from '../../../shared/canvasMaintenance';
import { serializeFileMutation } from './atomicFile';
import { verifyImagePresentation } from '../canvas/presentationValidation';

const MINIMUM_AGE = 24 * 60 * 60_000;
const TOKEN_LIFETIME = 10 * 60_000;
const MAX_FILES = 20_000;
const MAX_REFERENCE_BYTES = 64 * 1024 * 1024;
const MEDIA = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
interface Identity { dev: string; ino: string; size: string; mtime: string; ctime: string }
interface StoredFile { path: string; identity: Identity; blob: string; status: 'pending' | 'quarantined' | 'restored' }
interface Manifest { id: string; createdAt: string; requestHash: string; files: StoredFile[] }
interface ScanRecord { expires: number; files: Map<string, Identity> }

export class CanvasMaintenanceError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
function identity(file: string): Identity {
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CanvasMaintenanceError('文件不是普通文件', 409);
  return { dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtime: String(stat.mtimeNs), ctime: String(stat.ctimeNs) };
}
function same(a: Identity, b: Identity, includeChangeTime = true) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtime === b.mtime && (!includeChangeTime || a.ctime === b.ctime);
}
function segment(value: string) {
  if (!value || value === '.' || value === '..' || /[\\/:<>"|?*%#]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value)) throw new CanvasMaintenanceError('维护路径无效');
}
function assetParts(value: string) {
  const parts = value.split('/');
  if (parts.length !== 2) throw new CanvasMaintenanceError('维护只接受画布内的直接文件');
  parts.forEach(segment); return parts;
}
/** Every path component is checked before access; directory links and junctions are never followed. */
function checked(root: string, parts: string[], createDirectories = false): string {
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    segment(parts[i]); current = path.join(current, parts[i]);
    if (createDirectories && !existsSync(current)) mkdirSync(current);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || realpathSync(current) !== current || (i < parts.length - 1 && !stat.isDirectory()))
      throw new CanvasMaintenanceError('维护路径包含链接或已变化', 409);
  }
  return current;
}
function saveManifest(root: string, manifest: Manifest) {
  const dir = checked(root, ['canvas-quarantine', manifest.id]);
  const temporary = path.join(dir, `.manifest-${nanoid()}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(manifest), 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    const target = path.join(dir, 'manifest.json');
    if (existsSync(target)) checked(root, ['canvas-quarantine', manifest.id, 'manifest.json']);
    renameSync(temporary, target);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function summary(manifest: Manifest): CanvasQuarantineBatch {
  return { id: manifest.id, createdAt: manifest.createdAt, files: manifest.files.map((file) => ({ path: file.path, byteSize: Number(file.identity.size), status: file.status })) };
}

/** No registry row is removed. Only explicitly selected, old, unregistered, unreferenced files may move. */
export function createCanvasMaintenance(handle: DbHandle, dataRoot: string, now: () => number = Date.now) {
  const scans = new Map<string, ScanRecord>();
  const rootFor = () => {
    const absolute = path.resolve(dataRoot);
    if (lstatSync(absolute).isSymbolicLink()) throw new CanvasMaintenanceError('数据根目录是链接，需手工复核', 409);
    return realpathSync(absolute);
  };
  const mutationKey = path.join(path.resolve(dataRoot), 'canvas-quarantine', '.maintenance-lock');
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const pathKey = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;

  function references(root: string, files: CanvasMaintenanceFile[]) {
    const protectedPaths = new Set<string>();
    const warnings: string[] = [];
    const byCanvas = new Map<string, number>();
    const knownPaths = new Set(files.map((file) => pathKey(file.path)));
    for (const file of files) {
      const [canvasId, basename = ''] = file.path.split('/');
      byCanvas.set(pathKey(canvasId), Math.max(byCanvas.get(pathKey(canvasId)) ?? 0, basename.length));
    }
    let bytes = 0; let cells = 0;
    const inspect = (value: string) => {
      bytes += Buffer.byteLength(value); cells++;
      if (bytes > MAX_REFERENCE_BYTES || cells > 200_000) throw new Error('引用扫描超出上限');
      let normalized = value.replace(/\\\//g, '/').replace(/\\\\/g, '/').replace(/\\/g, '/');
      // Decode valid URL escapes locally: an unrelated prose "100%" must not hide a path.
      normalized = normalized.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
        try { return decodeURIComponent(encoded); } catch { return encoded; }
      });
      normalized = pathKey(normalized);
      if (knownPaths.has(normalized)) protectedPaths.add(normalized);
      for (const match of normalized.matchAll(/([A-Za-z0-9_-]+)\//g)) {
        const maximumNameLength = byCanvas.get(match[1]);
        if (!maximumNameLength) continue;
        const start = match.index + match[0].length;
        const basename = normalized.slice(start, start + maximumNameLength).match(/^[^\s"'<>[\]{}(),;/?#\\]+/)?.[0] ?? '';
        // Prefix checks preserve paths embedded in prose/URLs without a files-by-messages product.
        for (let end = basename.length; end > 0; end--) {
          const candidate = `${match[1]}/${basename.slice(0, end)}`;
          if (knownPaths.has(candidate)) protectedPaths.add(candidate);
        }
      }
    };
    const inspectJson = (value: unknown): void => {
      if (typeof value === 'string') inspect(value);
      else if (Array.isArray(value)) value.forEach(inspectJson);
      else if (value && typeof value === 'object') Object.values(value).forEach(inspectJson);
    };
    try {
      // Inspect all persisted text, including command receipts, retained commits, jobs, deliveries,
      // deleted-node history, messages, and future schema columns. Never return their contents.
      const tables = handle.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      const databases = handle.raw.prepare('PRAGMA database_list').all() as { name: string; file: string }[];
      if (databases.some((database) => database.name !== 'main' && database.name !== 'temp')) warnings.push('存在额外挂载数据库，候选需复核');
      for (const table of tables) {
        const schema = handle.raw.prepare(`PRAGMA table_info(${quote(table.name)})`).all() as { name: string; type: string }[];
        if (schema.some((column) => !column.type || /BLOB/i.test(column.type))) warnings.push('数据库包含无法判断的字段格式，候选需复核');
        const columns = schema.filter((column) => /TEXT|CHAR|CLOB/i.test(column.type));
        if (!columns.length) continue;
        for (const row of handle.raw.prepare(`SELECT ${columns.map((column) => quote(column.name)).join(',')} FROM ${quote(table.name)}`).iterate()) {
          for (const column of columns) {
            const value = row[column.name];
            if (typeof value !== 'string') continue;
            try { inspectJson(JSON.parse(value)); }
            catch { if (column.name.endsWith('_json')) warnings.push(`数据库 ${table.name}.${column.name} 无法解析，候选需复核`); }
            inspect(value);
          }
        }
      }
      // JSON-only sessions, spilled tool outputs, old artifacts, and local metadata can also hold refs.
      // Our native export has no external references. Recognize only a successful immutable
      // version, and still scan its persisted sourcePages/job input above to protect page images.
      const nativeExports = new Map<string, { digest: string; byteSize: number; pageCount: number }>();
      const nativeVersions = handle.raw.prepare(`SELECT v.artifact_id, v.n, v.blob_path, v.content_digest, v.byte_size, v.origin_json
        FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
        WHERE v.storage = 'blob' AND a.kind = 'binary' AND a.mime_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'`)
        .all() as { artifact_id: string; n: number; blob_path: string; content_digest: string; byte_size: number; origin_json: string }[];
      for (const version of nativeVersions) {
        const origin = JSON.parse(version.origin_json) as { providerId?: string; model?: string; jobId?: string; canvasNodeId?: string };
        if (origin.providerId !== 'local' || origin.model !== 'pptxgenjs-4.0.1' || !origin.jobId) continue;
        const job = handle.raw.prepare('SELECT status, node_id, input_json, result_json FROM canvas_jobs WHERE id = ?').get(origin.jobId) as { status: string; node_id: string; input_json: string; result_json: string } | undefined;
        if (!job || job.status !== 'succeeded' || job.node_id !== origin.canvasNodeId) continue;
        const result = JSON.parse(job.result_json) as { artifactId?: string; artifactVersion?: number; contentHash?: string; pageCount?: number };
        const input = JSON.parse(job.input_json) as { artifactId?: string; sources?: unknown[] };
        if (result.artifactId !== version.artifact_id || result.artifactVersion !== version.n || result.contentHash !== version.content_digest ||
          input.artifactId !== version.artifact_id || !Array.isArray(input.sources) || input.sources.length !== result.pageCount || !Number.isSafeInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 40) continue;
        nativeExports.set(pathKey(path.join(root, 'artifacts', 'blobs', version.blob_path)), { digest: version.content_digest, byteSize: version.byte_size, pageCount: result.pageCount });
      }
      let count = 0;
      const visit = (parts: string[]) => {
        const dir = checked(root, parts);
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (++count > MAX_FILES) throw new Error('持久文件引用扫描超出上限');
          if (!parts.length && entry.name === 'canvas-quarantine') continue;
          const next = [...parts, entry.name];
          const absolute = checked(root, next);
          if (entry.isDirectory()) { visit(next); continue; }
          if (!entry.isFile()) throw new Error('引用目录含非常规文件');
          const extension = path.extname(entry.name).toLowerCase();
          const knownDatabase = databases.some((database) => database.file && ['', '-wal', '-shm', '-journal'].some((suffix) => pathKey(path.resolve(database.file + suffix)) === pathKey(absolute)));
          if (MEDIA.has(extension) || knownDatabase) continue;
          const nativeExport = nativeExports.get(pathKey(absolute));
          if (nativeExport) {
            const stat = lstatSync(absolute);
            if (stat.size !== nativeExport.byteSize || stat.size > MAX_REFERENCE_BYTES - bytes) throw new Error('原生导出包超出引用复核上限或已变化');
            const contents = readFileSync(absolute); bytes += contents.length;
            if (createHash('sha256').update(contents).digest('hex') !== nativeExport.digest) throw new Error('原生导出包内容已变化，候选需复核');
            verifyImagePresentation(contents, nativeExport.pageCount); continue;
          }
          if (next[0] === 'canvas' && /^\.asset-[A-Za-z0-9_-]+\.part$/.test(entry.name)) continue;
          if (/\.(part|tmp)$/i.test(entry.name)) throw new Error('持久引用文件正在写入，稍后再扫描');
          if (!['.json', '.md', '.txt', '.log', '.html'].includes(extension) && next[0] !== 'refs')
            throw new Error('存在无法判断的持久文件类型');
          const stat = lstatSync(absolute);
          if (stat.size > MAX_REFERENCE_BYTES - bytes) throw new Error('持久文件引用扫描超出上限');
          const text = readFileSync(absolute, 'utf8');
          try { inspectJson(JSON.parse(text)); }
          catch { if (extension === '.json') warnings.push('持久 JSON 文件无法解析，候选需复核'); }
          inspect(text);
        }
      };
      visit([]);
    } catch (error) { warnings.push(error instanceof Error ? error.message : '引用扫描未完成'); }
    const registered = new Set((handle.raw.prepare('SELECT path FROM canvas_assets').all() as { path: string }[]).map((row) => pathKey(row.path)));
    return { protectedPaths, registered, warnings: [...new Set(warnings)] };
  }

  function enumerate(root: string): { files: CanvasMaintenanceFile[]; identities: Map<string, Identity>; warnings: string[] } {
    const files: CanvasMaintenanceFile[] = []; const identities = new Map<string, Identity>(); const warnings: string[] = [];
    if (!existsSync(path.join(root, 'canvas'))) return { files, identities, warnings };
    const dir = checked(root, ['canvas']);
    for (const canvas of readdirSync(dir, { withFileTypes: true })) {
      try {
        const parent = checked(root, ['canvas', canvas.name]);
        if (!canvas.isDirectory()) { files.push({ path: canvas.name, status: 'review', reasons: ['画布目录不是普通目录'] }); continue; }
        for (const file of readdirSync(parent, { withFileTypes: true })) {
          const relative = `${canvas.name}/${file.name}`;
          if (files.length >= MAX_FILES) { warnings.push('文件清单超出上限，需缩小范围后复核'); return { files, identities, warnings }; }
          try {
            const absolute = checked(root, ['canvas', ...assetParts(relative)]);
            if (!file.isFile()) throw new Error('链接、子目录或非常规文件不参与隔离');
            const stat = lstatSync(absolute);
            identities.set(relative, identity(absolute));
            const reasons: string[] = [];
            if (file.name.startsWith('.') || /\.(part|tmp)$/i.test(file.name)) reasons.push('暂存或隐藏文件受保护');
            if (now() - Math.max(stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs) < MINIMUM_AGE) reasons.push('最近 24 小时内创建或变更');
            if (!MEDIA.has(path.extname(file.name).toLowerCase()) || !/^[A-Za-z0-9_-]+$/.test(canvas.name) || !/^[A-Za-z0-9_.-]+$/.test(file.name)) reasons.push('未知文件或目录命名，需要人工复核');
            files.push({ path: relative, byteSize: stat.size, modifiedAt: stat.mtime.toISOString(), status: reasons.length ? 'review' : 'candidate', reasons });
          } catch { files.push({ path: relative, status: 'review', reasons: ['链接、非常规文件或扫描时已变化'] }); }
        }
      } catch { files.push({ path: canvas.name, status: 'review', reasons: ['链接或目录扫描失败'] }); }
    }
    return { files, identities, warnings };
  }

  function readManifest(root: string, id: string): Manifest {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new CanvasMaintenanceError('隔离记录 ID 无效');
    const file = checked(root, ['canvas-quarantine', id, 'manifest.json']);
    if (lstatSync(file).size > 1024 * 1024) throw new CanvasMaintenanceError('隔离清单过大', 409);
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
    if (manifest.id !== id || !Array.isArray(manifest.files) || manifest.files.length > 100) throw new CanvasMaintenanceError('隔离清单无效', 409);
    const paths = new Set<string>(); const blobs = new Set<string>();
    for (const entry of manifest.files) {
      assetParts(entry.path);
      const validIdentity = entry.identity && (['dev', 'ino', 'size'] as const).every((key) => /^\d+$/.test(entry.identity[key])) &&
        (['mtime', 'ctime'] as const).every((key) => /^-?\d+$/.test(entry.identity[key]));
      if (!/^\d+\.blob$/.test(entry.blob) || !validIdentity ||
        !['pending', 'quarantined', 'restored'].includes(entry.status) || paths.has(entry.path) || blobs.has(entry.blob))
        throw new CanvasMaintenanceError('隔离清单路径无效', 409);
      paths.add(entry.path); blobs.add(entry.blob);
    }
    return manifest;
  }

  return {
    scan(): CanvasMaintenanceScan {
      const root = rootFor(); const { files, identities, warnings } = enumerate(root);
      const refs = references(root, files); warnings.push(...refs.warnings);
      for (const file of files) {
        if (refs.registered.has(pathKey(file.path)) || refs.protectedPaths.has(pathKey(file.path))) {
          file.status = 'protected'; file.reasons.unshift(refs.registered.has(pathKey(file.path)) ? '登记素材（包括历史版本）' : '持久文档或任务历史仍有引用');
        } else if (warnings.length) { file.status = 'review'; file.reasons.push('引用扫描不完整，需要人工复核'); }
      }
      const token = nanoid(); const expires = now() + TOKEN_LIFETIME;
      for (const [key, value] of scans) if (value.expires < now()) scans.delete(key);
      if (scans.size >= 10) scans.delete(scans.keys().next().value);
      scans.set(token, { expires, files: new Map(files.filter((file) => file.status === 'candidate').map((file) => [file.path, identities.get(file.path)])) });
      return { token, expiresAt: new Date(expires).toISOString(), minimumAgeHours: 24, referencesComplete: !warnings.length, warnings, files };
    },
    quarantine(token: string, selectedPaths: string[], operationId: string): Promise<CanvasQuarantineBatch> {
      return serializeFileMutation(mutationKey, async () => {
        if (!operationId?.trim() || operationId.length > 256) throw new CanvasMaintenanceError('隔离操作需要稳定的操作 ID');
        const paths = [...new Set(selectedPaths)].sort();
        if (!paths.length || paths.length > 100) throw new CanvasMaintenanceError('每次显式选择 1 至 100 个文件');
        paths.forEach(assetParts);
        const root = rootFor(); const id = createHash('sha256').update(operationId).digest('hex');
        const requestHash = createHash('sha256').update(JSON.stringify({ token, paths })).digest('hex');
        if (existsSync(path.join(root, 'canvas-quarantine', id, 'manifest.json'))) {
          const previous = readManifest(root, id);
          if (previous.requestHash !== requestHash) throw new CanvasMaintenanceError('该操作 ID 已用于其他隔离清单', 409);
          return summary(previous);
        }
        const scan = scans.get(token);
        if (!scan || scan.expires < now()) throw new CanvasMaintenanceError('扫描清单已过期，请重新扫描', 409);
        for (const relative of paths) if (!scan.files.has(relative)) throw new CanvasMaintenanceError('文件不在可隔离的扫描候选中', 409);
        const inventory = enumerate(root);
        if (inventory.warnings.length) throw new CanvasMaintenanceError('目录扫描不完整，暂不能隔离', 409);
        const refs = references(root, inventory.files);
        if (refs.warnings.length) throw new CanvasMaintenanceError('引用扫描不完整，暂不能隔离', 409);
        const manifest: Manifest = { id, requestHash, createdAt: new Date(now()).toISOString(), files: paths.map((relative, index) => ({ path: relative, blob: `${index}.blob`, identity: scan.files.get(relative), status: 'pending' })) };
        // The final reference check and filesystem move run synchronously under SQLite's write lock:
        // neither this process nor another SQLite writer can add a reference between them.
        handle.raw.exec('BEGIN IMMEDIATE');
        try {
          const currentRefs = references(root, inventory.files);
          if (currentRefs.warnings.length) throw new CanvasMaintenanceError('引用复核未完成', 409);
          for (const file of manifest.files) {
            if (currentRefs.registered.has(pathKey(file.path)) || currentRefs.protectedPaths.has(pathKey(file.path))) throw new CanvasMaintenanceError('候选文件已新增引用，请重新扫描', 409);
            const candidate = inventory.files.find((entry) => entry.path === file.path);
            const source = checked(root, ['canvas', ...assetParts(file.path)]);
            if (candidate?.status !== 'candidate' || !same(file.identity, identity(source))) throw new CanvasMaintenanceError('文件已变更或不再符合隔离条件', 409);
          }
          checked(root, ['canvas-quarantine', id], true);
          saveManifest(root, manifest);
          for (const file of manifest.files) {
            const source = checked(root, ['canvas', ...assetParts(file.path)]);
            const destination = path.join(checked(root, ['canvas-quarantine', id]), file.blob);
            linkSync(source, destination); // exclusive: cannot replace an existing destination
            if (!same(file.identity, identity(source), false) || !same(file.identity, identity(destination), false)) throw new CanvasMaintenanceError('隔离期间文件发生变化，保留副本供恢复', 409);
            unlinkSync(source); file.identity = identity(destination); file.status = 'quarantined'; saveManifest(root, manifest);
          }
          handle.raw.exec('COMMIT'); return summary(manifest);
        } catch (error) { handle.raw.exec('ROLLBACK'); throw error; }
      });
    },
    list(): CanvasQuarantineBatch[] {
      const root = rootFor(); if (!existsSync(path.join(root, 'canvas-quarantine'))) return [];
      const dir = checked(root, ['canvas-quarantine']);
      return readdirSync(dir).filter((id) => /^[a-f0-9]{64}$/.test(id)).flatMap((id) => {
        try {
          const batchDir = checked(root, ['canvas-quarantine', id]);
          const entries = readdirSync(batchDir);
          // No media moves before the initial manifest is durable. A stop during that initial
          // write can leave an empty or temp-only directory; other recovery records stay visible.
          if (entries.every((name) => /^\.manifest-[A-Za-z0-9_-]+\.tmp$/.test(name))) return [];
          return [summary(readManifest(root, id))];
        } catch {
          return [{ id, createdAt: lstatSync(path.join(dir, id)).mtime.toISOString(), files: [],
            reviewReason: '隔离记录无法安全读取，需手工复核；文件已保留' }];
        }
      });
    },
    restore(id: string, selectedPaths: string[]): Promise<CanvasQuarantineBatch> {
      return serializeFileMutation(mutationKey, async () => {
        const root = rootFor(); const manifest = readManifest(root, id);
        const paths = new Set(selectedPaths);
        if (!paths.size || paths.size > 100 || [...paths].some((relative) => !manifest.files.some((file) => file.path === relative)))
          throw new CanvasMaintenanceError('恢复清单必须来自该隔离记录');
        for (const file of manifest.files.filter((file) => paths.has(file.path))) {
          if (file.status === 'restored') continue;
          const originalParts = assetParts(file.path);
          const parent = checked(root, ['canvas', originalParts[0]], true);
          const destination = path.join(parent, originalParts[1]);
          const quarantineParent = checked(root, ['canvas-quarantine', id]);
          if (!existsSync(path.join(quarantineParent, file.blob))) {
            // Recover a crash before quarantine linked the source, or after restore unlinked its copy.
            checked(root, ['canvas', ...originalParts]);
            if (!same(file.identity, identity(destination), false)) throw new CanvasMaintenanceError('恢复文件缺失或已变化，需手工复核', 409);
            file.status = 'restored'; saveManifest(root, manifest); continue;
          }
          const source = checked(root, ['canvas-quarantine', id, file.blob]);
          if (!same(file.identity, identity(source), false)) throw new CanvasMaintenanceError('隔离文件已被替换或修改，需手工复核', 409);
          if (existsSync(destination)) {
            checked(root, ['canvas', ...originalParts]);
            if (!same(identity(source), identity(destination), false)) throw new CanvasMaintenanceError('原路径已有其他文件，恢复不会覆盖', 409);
          } else linkSync(source, destination);
          unlinkSync(source); file.status = 'restored'; saveManifest(root, manifest);
        }
        return summary(manifest);
      });
    },
  };
}
