import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { VOICE_FILES, VOICE_MODEL, VOICE_REVISION, type VoiceModelStatus } from '../../../shared/voiceInput';

export function createVoiceModelStore(dataRoot: string, fetcher: typeof fetch = fetch, seedRoot?: string, files: readonly (readonly [string, number, string])[] = VOICE_FILES) {
  const root = path.join(dataRoot, 'models', 'voice', VOICE_REVISION);
  const verified = new Set<string>();
  let task: Promise<void> | undefined;
  let progress = 0;
  let error: string | undefined;
  const total = files.reduce((sum, file) => sum + file[1], 0);
  const valid = (bytes: Buffer, file: readonly [string, number, string]) => bytes.length === file[1] && createHash('sha256').update(bytes).digest('hex') === file[2];
  async function check(file: readonly [string, number, string]) {
    if (verified.has(file[0])) return true;
    try { if (valid(await readFile(path.join(root, file[0])), file)) { verified.add(file[0]); return true; } } catch { /* missing */ }
    return false;
  }
  async function status(): Promise<VoiceModelStatus> {
    await Promise.all(files.map(check));
    const cached = files.reduce((sum, file) => sum + (verified.has(file[0]) ? file[1] : 0), 0);
    return { ready: verified.size === files.length, downloading: !!task, bytes: Math.min(total, cached + progress), total, error };
  }
  async function prepare() {
    if (task) return task;
    error = undefined;
    task = (async () => {
      for (const file of files) {
        if (await check(file)) continue;
        let bytes: Buffer | undefined;
        if (seedRoot) {
          try { const seed = await readFile(path.join(seedRoot, VOICE_MODEL, file[0])); if (valid(seed, file)) bytes = seed; } catch { /* no reusable cache */ }
        }
        if (!bytes) {
          const response = await fetcher(`https://huggingface.co/${VOICE_MODEL}/resolve/${VOICE_REVISION}/${file[0]}`, { signal: AbortSignal.timeout(10 * 60_000) });
          if (!response.ok || !response.body) throw new Error('语音模型下载失败，请检查网络后重试');
          const chunks: Uint8Array[] = [];
          progress = 0;
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              progress += value.length;
              if (progress > file[1]) throw new Error('语音模型文件大小不符');
              chunks.push(value);
            }
          } finally { await reader.cancel().catch((): void => undefined); reader.releaseLock(); }
          bytes = Buffer.concat(chunks);
        }
        if (!valid(bytes, file)) throw new Error('语音模型校验失败，请重新下载');
        const destination = path.join(root, file[0]);
        await mkdir(path.dirname(destination), { recursive: true });
        try { await writeFile(destination + '.partial', bytes); await rename(destination + '.partial', destination); }
        finally { await rm(destination + '.partial', { force: true }); }
        verified.add(file[0]); progress = 0;
      }
    })().catch((cause) => { error = cause instanceof Error ? cause.message : '语音模型准备失败'; throw cause; })
      .finally(() => { task = undefined; progress = 0; });
    return task;
  }
  async function read(name: string) {
    const file = files.find(entry => entry[0] === name);
    if (!file || !(await check(file))) return null;
    return readFile(path.join(root, file[0]));
  }
  return { status, prepare, read };
}
