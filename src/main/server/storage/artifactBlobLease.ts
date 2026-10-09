import { createHash } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';

function same(a: { ino: bigint; dev: bigint }, b: { ino: bigint; dev: bigint }) {
  return a.ino === b.ino && (a.dev === b.dev || process.platform === 'win32' && (a.dev === 0n || b.dev === 0n));
}
async function blobRoot(dataRoot: string, create = false) {
  const root = await realpath(path.resolve(dataRoot)); let current = root;
  for (const name of ['artifacts', 'blobs']) {
    current = path.join(current, name); if (create) await mkdir(current, { recursive: false }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || path.relative(current, await realpath(current))) throw new Error('Artifact blob root is unsafe');
  }
  return current;
}
/** Native artifact read, with the same canonical containment and inode checks as canvas media. */
export async function readArtifactBlob(dataRoot: string, relative: string): Promise<Buffer> {
  const parts = relative.split('/');
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) throw new Error('Invalid artifact blob path');
  const root = await blobRoot(dataRoot); const parent = path.join(root, parts[0]);
  const parentStat = await lstat(parent);
  if (parentStat.isSymbolicLink() || path.relative(parent, await realpath(parent))) throw new Error('Artifact blob directory is unsafe');
  const file = path.join(parent, parts[1]); const stat = await lstat(file, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Artifact blob is not a regular file');
  const handle = await open(file, 'r');
  try {
    if (!same(stat, await handle.stat({ bigint: true })) || path.relative(parent, await realpath(path.dirname(file)))) throw new Error('Artifact blob changed while opening');
    return await readFile(handle);
  } finally { await handle.close(); }
}

export async function stageArtifactBlob(dataRoot: string, artifactId: string, version: number, bytes: Buffer, signal?: AbortSignal) {
  if (!/^[A-Za-z0-9_-]+$/.test(artifactId) || !Number.isSafeInteger(version) || version < 1 || !bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('Invalid artifact blob');
  signal?.throwIfAborted();
  await mkdir(path.resolve(dataRoot), { recursive: true });
  const root = await blobRoot(dataRoot, true); const dir = path.join(root, artifactId);
  await mkdir(dir, { recursive: false }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
  const parent = await lstat(dir, { bigint: true });
  if (parent.isSymbolicLink() || !parent.isDirectory() || path.relative(dir, await realpath(dir))) throw new Error('Artifact blob directory is unsafe');
  const nonce = nanoid(); const basename = `v${version}-${nonce}.pptx`;
  const part = path.join(dir, `.artifact-${nonce}.part`); const final = path.join(dir, basename);
  const owned = new Map<string, { ino: bigint; dev: bigint }>();
  let kept = false; let disposal: Promise<void> | undefined;
  const checkParent = async () => {
    const current = await lstat(dir, { bigint: true });
    if (current.isSymbolicLink() || current.ino !== parent.ino || current.dev !== parent.dev || path.relative(root, await blobRoot(dataRoot)) || path.relative(dir, await realpath(dir))) throw new Error('Artifact directory changed');
  };
  const remove = async (file: string) => {
    if (!owned.has(file)) return;
    await checkParent();
    let stat;
    try { stat = await lstat(file, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { owned.delete(file); return; } throw error; }
    if (stat.isSymbolicLink() || !same(stat, owned.get(file))) throw new Error('Refusing to remove a replaced artifact file');
    await unlink(file); owned.delete(file);
  };
  const onAbort = () => { void discard().catch(() => console.warn('[artifact] cancelled blob cleanup requires review')); };
  function discard(): Promise<void> {
    if (kept) return Promise.resolve();
    if (!disposal) { signal?.removeEventListener('abort', onAbort); disposal = (async () => { for (const file of [...owned.keys()].reverse()) await remove(file); })(); }
    return disposal;
  }
  try {
    const handle = await open(part, 'wx', 0o600);
    try { owned.set(part, await handle.stat({ bigint: true })); signal?.throwIfAborted(); await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    signal?.throwIfAborted(); await checkParent(); await link(part, final); owned.set(final, owned.get(part)); await remove(part);
    signal?.throwIfAborted(); signal?.addEventListener('abort', onAbort, { once: true });
    return { blobPath: `${artifactId}/${basename}`, byteSize: bytes.length, digest: createHash('sha256').update(bytes).digest('hex'),
      prepareCommit() { signal?.throwIfAborted(); if (disposal) throw new Error('Artifact lease was discarded'); signal?.removeEventListener('abort', onAbort); },
      keep() { if (disposal) throw new Error('Artifact lease was discarded'); kept = true; signal?.removeEventListener('abort', onAbort); }, discard };
  } catch (error) { await discard(); throw error; }
}
