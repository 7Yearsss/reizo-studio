import { createHash } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { CanvasAssetKind } from '../../../shared/canvasAssets';

export interface CanvasAssetFileInput { name: string; bytes: Uint8Array; mimeType: string; kind: CanvasAssetKind }
export interface StagedCanvasAsset { id: string; path: string; byteSize: number; contentHash: string; mimeType: string; kind: CanvasAssetKind }
export interface StagedCanvasAssets { files: StagedCanvasAsset[]; keep(): void; discard(): Promise<void> }

function segment(value: string): void {
  if (!value || value === '.' || value === '..' || /[\\/:<>"|?*%#]/.test(value) || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value)) throw new Error('Invalid canvas asset path');
}

function relativePath(value: string): string[] {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) throw new Error('Canvas asset path must be relative');
  const parts = value.split('/');
  if (parts.length < 2) throw new Error('Canvas asset path must include its canvas');
  parts.forEach(segment);
  return parts;
}

export function canvasAssetsDir(dataRoot: string, canvasId: string): string {
  segment(canvasId);
  return path.resolve(dataRoot, 'canvas', canvasId);
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sameFile(a: { dev: bigint; ino: bigint }, b: { dev: bigint; ino: bigint }): boolean {
  // Windows path stat can report dev=0 while fstat reports the volume ID.
  // Canonical root/parent checks constrain the volume; compare the exact file ID.
  return a.ino === b.ino && (a.dev === b.dev || process.platform === 'win32' && (a.dev === 0n || b.dev === 0n));
}

async function existingRoot(dataRoot: string): Promise<string> {
  const actualData = await realpath(path.resolve(dataRoot));
  const expected = path.join(actualData, 'canvas');
  const actual = await realpath(path.resolve(dataRoot, 'canvas'));
  if (path.relative(expected, actual) !== '') throw new Error('Canvas asset root follows an unsafe link');
  return actual;
}

/** Legacy assets remain readable without registry rows, with canonical filesystem containment checks. */
export async function readCanvasAsset(dataRoot: string, relative: string): Promise<Buffer> {
  const parts = relativePath(relative);
  const root = await existingRoot(dataRoot);
  const target = await realpath(path.resolve(dataRoot, 'canvas', ...parts));
  if (!within(root, target)) throw new Error('Canvas asset path escapes its root');
  const handle = await open(target, 'r');
  try {
    const current = await realpath(target);
    const file = await lstat(target, { bigint: true });
    const opened = await handle.stat({ bigint: true });
    if (!within(root, current) || file.isSymbolicLink() || !sameFile(file, opened) || !opened.isFile()) {
      throw new Error('Canvas asset changed while opening');
    }
    return await readFile(handle);
  } finally { await handle.close(); }
}

interface OwnedFile { absolute: string; dev: bigint; ino: bigint }

/**
 * Complete bytes are published with an exclusive hard link on the same filesystem.
 * The lease owns only its unique parts/finals; caller commits metadata and then keeps it.
 */
export async function stageCanvasAssets(dataRoot: string, canvasId: string, files: CanvasAssetFileInput[], signal?: AbortSignal): Promise<StagedCanvasAssets> {
  segment(canvasId);
  const inputs = files.map((file) => {
    segment(file.name);
    if (!file.bytes?.byteLength || !/^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType)) throw new Error('Canvas asset requires non-empty bytes and a valid MIME type');
    return { ...file, bytes: Buffer.from(file.bytes) };
  });
  signal?.throwIfAborted();
  await mkdir(path.resolve(dataRoot), { recursive: true });
  signal?.throwIfAborted();
  await mkdir(path.resolve(dataRoot, 'canvas'), { recursive: true });
  const root = await existingRoot(dataRoot);
  signal?.throwIfAborted();
  const dir = canvasAssetsDir(dataRoot, canvasId);
  await mkdir(dir, { recursive: true });
  const parent = await realpath(dir);
  if (path.relative(path.join(root, canvasId), parent) !== '') throw new Error('Canvas asset directory follows an unsafe link');
  const parentStat = await lstat(parent, { bigint: true });
  const owned = new Map<string, OwnedFile>();
  const staged: StagedCanvasAsset[] = [];
  let kept = false;
  let disposal: Promise<void> | undefined;
  let abortListener: (() => void) | undefined;

  async function checkParent(): Promise<void> {
    if (path.relative(root, await existingRoot(dataRoot)) !== '' || path.relative(parent, await realpath(dir)) !== '') {
      throw new Error('Canvas asset directory changed during staging');
    }
    const current = await lstat(parent, { bigint: true });
    if (current.isSymbolicLink() || current.dev !== parentStat.dev || current.ino !== parentStat.ino) throw new Error('Canvas asset directory was replaced');
  }

  async function removeOwned(absolute: string): Promise<void> {
    const identity = owned.get(absolute);
    if (!identity) return;
    await checkParent();
    let file;
    try { file = await lstat(absolute, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { owned.delete(absolute); return; } throw error; }
    if (file.isSymbolicLink() || !sameFile(file, identity)) throw new Error('Refusing to remove a replaced asset file');
    await unlink(absolute);
    owned.delete(absolute);
  }

  function discard(): Promise<void> {
    if (kept) return Promise.resolve();
    if (disposal) return disposal;
    if (abortListener) signal?.removeEventListener('abort', abortListener);
    disposal = (async () => {
      const failures: unknown[] = [];
      for (const absolute of [...owned.keys()].reverse()) {
        try { await removeOwned(absolute); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Canvas asset cleanup failed');
    })();
    return disposal;
  }

  try {
    for (const file of inputs) {
      signal?.throwIfAborted();
      await checkParent();
      const id = nanoid();
      const ext = path.extname(file.name);
      const basename = file.name.slice(0, file.name.length - ext.length);
      const finalName = `${basename}-${id}${ext}`;
      const part = path.join(dir, `.asset-${id}-${nanoid()}.part`);
      const final = path.join(dir, finalName);
      const handle = await open(part, 'wx', 0o600);
      try {
        const identity = await handle.stat({ bigint: true });
        owned.set(part, { absolute: part, dev: identity.dev, ino: identity.ino });
        signal?.throwIfAborted();
        await writeFile(handle, file.bytes);
        await handle.sync();
      } finally { await handle.close(); }
      signal?.throwIfAborted();
      await checkParent();
      const identity = owned.get(part);
      // link fails with EEXIST rather than overwriting an existing final asset.
      await link(part, final);
      owned.set(final, { ...identity, absolute: final });
      signal?.throwIfAborted();
      await removeOwned(part);
      staged.push({ id, path: `${canvasId}/${finalName}`, byteSize: file.bytes.byteLength,
        contentHash: createHash('sha256').update(file.bytes).digest('hex'), mimeType: file.mimeType, kind: file.kind });
    }
    signal?.throwIfAborted();
    abortListener = () => { void discard().catch((error: unknown) => console.warn('[canvas] cancelled asset cleanup failed', error)); };
    signal?.addEventListener('abort', abortListener, { once: true });
    return {
      files: staged,
      keep() {
        if (kept) return;
        if (disposal) throw new Error('Discarded assets cannot be published');
        kept = true;
        signal?.removeEventListener('abort', abortListener);
      },
      discard,
    };
  } catch (error) {
    try { await discard(); } catch (cleanup) { console.warn('[canvas] staged asset cleanup failed', cleanup); }
    throw error;
  }
}
