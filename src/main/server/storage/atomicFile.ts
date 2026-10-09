import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';

const queues = new Map<string, Promise<unknown>>();
export function serializeFileMutation<T>(file: string, mutation: () => Promise<T>): Promise<T> {
  const absolute = path.resolve(file);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch((): void => undefined).then(mutation);
  queues.set(key, current);
  void current.finally(() => { if (queues.get(key) === current) queues.delete(key); }).catch((): void => undefined);
  return current;
}

/** Write complete bytes beside the destination before replacing it; a failed write keeps the prior file. */
export async function writeTextAtomic(file: string, content: string): Promise<void> {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}-${nanoid()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, absolute);
  } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
}
