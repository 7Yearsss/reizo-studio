import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';

const { VOICE_MODEL, VOICE_REVISION, VOICE_FILES } = await tsImport('../src/shared/voiceInput.ts', import.meta.url);
const root = path.resolve('.cache/voice-model', VOICE_REVISION, VOICE_MODEL);
for (const [name, length, sha256] of VOICE_FILES) {
  const valid = bytes => bytes.length === length && createHash('sha256').update(bytes).digest('hex') === sha256;
  const destination = path.join(root, name);
  let bytes;
  for (const candidate of [destination, path.resolve('.cache/local-asr-models', VOICE_MODEL, name)]) {
    try { const cached = await readFile(candidate); if (valid(cached)) { bytes = cached; break; } } catch { /* absent cache */ }
  }
  if (!bytes) {
    const response = await fetch(`https://huggingface.co/${VOICE_MODEL}/resolve/${VOICE_REVISION}/${name}`, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw new Error(`Cannot download voice model ${name}: HTTP ${response.status}`);
    const chunks = []; let received = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > length) throw new Error(`Voice model exceeds pinned length: ${name}`);
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  }
  if (!valid(bytes)) throw new Error(`Voice model integrity failed: ${name}`);
  await mkdir(path.dirname(destination), { recursive: true });
  try { await writeFile(destination + '.partial', bytes); await rename(destination + '.partial', destination); }
  finally { await rm(destination + '.partial', { force: true }); }
  console.log(`Verified voice model: ${name} (${length} bytes)`);
}
await writeFile(path.resolve('.cache/voice-model/manifest.json'), JSON.stringify({ model: VOICE_MODEL, revision: VOICE_REVISION, files: VOICE_FILES }, null, 2));
